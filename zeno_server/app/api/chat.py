import asyncio
import json
import aiosqlite
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

# --- PURE LANGCHAIN IMPORTS (LangGraph Removed) ---
from langchain_core.tools import tool
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import HumanMessage, SystemMessage

from app.core.database import get_db
from app.services.retrieval import retrieve_for_video
from app.services.llm import get_llm
from app.models.schemas import ChatRequest, ChatResponse, VideoSource
from app.core.config import settings
from app.services.prompts import SYSTEM_PROMPT

router = APIRouter()
PUBLIC_USER = "public_user"

def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"

# --- DEFINE THE RAG TOOL FOR THE AGENT ---
@tool
def search_video_context(query: str, video_id: str) -> str:
    """
    Search the YouTube video's Pinecone vector database transcript for relevant information.
    Input the specific 'query' you want to search for, and the user's 'video_id'.
    """
    context, sources = retrieve_for_video(PUBLIC_USER, video_id, query)
    if not context:
        return "No relevant information found in the video transcript for this query."
    return context

# --- AGENT PROMPT SETUP ---
agent_prompt = ChatPromptTemplate.from_messages([
    ("system", SYSTEM_PROMPT),
    MessagesPlaceholder(variable_name="chat_history"),
    ("user", "{input}"),
    MessagesPlaceholder(variable_name="agent_scratchpad"),
])

@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    db: aiosqlite.Connection = Depends(get_db)
):
    if req.mode == "agent":
        # Pure LangChain Agent Execution
        llm = get_llm(streaming=False)
        tools = [search_video_context]
        
        agent = create_tool_calling_agent(llm, tools, agent_prompt)
        agent_executor = AgentExecutor(agent=agent, tools=tools, return_intermediate_steps=False)
        
        chat_history = [
            HumanMessage(content=m["content"]) if m["role"] == "user" else SystemMessage(content=m["content"])
            for m in req.history
        ]
        
        response = await agent_executor.ainvoke({
            "input": f"[Video ID: {req.video_id}] {req.query}",
            "chat_history": chat_history
        })
        final_answer = response["output"]
        
        return ChatResponse(
            answer=final_answer,
            sources=[],
            model=settings.model_name
        )
    else:
        # Standard Chain Execution (Fast Mode)
        context, sources = await asyncio.to_thread(
            retrieve_for_video, PUBLIC_USER, req.video_id, req.query
        )
        from app.services.prompts import build_prompt
        prompt = build_prompt(context, req.query)
        result = await get_llm().ainvoke(prompt)
        
        return ChatResponse(
            answer=result.content,
            sources=[VideoSource(**s) for s in sources],
            model=settings.model_name
        )


@router.post("/chat/stream")
async def chat_stream(
    req: ChatRequest,
    db: aiosqlite.Connection = Depends(get_db)
):
    async def generate():
        if not req.video_id:
            yield _sse({'type': 'token', 'content': 'No video selected.'})
            yield _sse({'type': 'done', 'model': settings.model_name})
            return

        context, sources = await asyncio.to_thread(
            retrieve_for_video, PUBLIC_USER, req.video_id, req.query
        )
        yield _sse({'type': 'sources', 'sources': sources})

        full = []
        
        if req.mode == "agent":
            # Pure LangChain Agent Streaming Execution
            llm_streaming = get_llm(streaming=True)
            tools = [search_video_context]
            
            agent = create_tool_calling_agent(llm_streaming, tools, agent_prompt)
            agent_executor = AgentExecutor(agent=agent, tools=tools)
            
            chat_history = [
                HumanMessage(content=m["content"]) if m["role"] == "user" else SystemMessage(content=m["content"]) 
                for m in req.history
            ]
            
            try:
                # Use astream_events to catch tokens directly from the agent
                async for event in agent_executor.astream_events(
                    {
                        "input": f"[Video ID: {req.video_id}] {req.query}",
                        "chat_history": chat_history
                    }, 
                    version="v2"
                ):
                    kind = event["event"]
                    if kind == "on_chat_model_stream":
                        chunk = event["data"]["chunk"].content
                        if chunk and isinstance(chunk, str):
                            full.append(chunk)
                            yield _sse({'type': 'token', 'content': chunk})
                            
                yield _sse({'type': 'done', 'model': settings.model_name})
            except Exception as e:
                yield _sse({'type': 'error', 'detail': f"Agent Error: {str(e)}"})

        else:
            # Standard Chain Streaming Execution
            if not context:
                yield _sse({'type': 'token', 'content': 'This topic is not covered in this video.'})
                yield _sse({'type': 'done', 'model': settings.model_name})
                return

            from app.services.prompts import build_prompt
            prompt = build_prompt(context, req.query)
            llm = get_llm(streaming=True)

            try:
                async for chunk in llm.astream(prompt):
                    if chunk.content:
                        full.append(chunk.content)
                        yield _sse({'type': 'token', 'content': chunk.content})
                yield _sse({'type': 'done', 'model': settings.model_name})
            except Exception as e:
                yield _sse({'type': 'error', 'detail': str(e)})

        # Save History to SQLite
        try:
            await db.execute(
                """
                INSERT INTO query_history (user_id, video_id, query, answer, sources_count, mode)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (PUBLIC_USER, req.video_id, req.query, "".join(full), len(sources), req.mode)
            )
            await db.commit()
        except Exception:
            pass

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )