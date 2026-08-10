import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { CheckCircle2Icon, Loader2Icon } from 'lucide-react'

/**
 * Stage prop:
 * 1 = Fetching Transcript
 * 2 = Chunking Transcript
 * 3 = Generating Embeddings
 * 4 = Indexing Complete
 */
export function RAGPipeline3D({ stage = 1, indexingMsg = 'Processing video...' }) {
  const containerRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const width = container.clientWidth || 320
    const height = 180

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
    camera.position.z = 180

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    // 2. Create Particle Buffer Geometry (300 particles for smooth 60fps)
    const particleCount = 300
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(particleCount * 3)
    const targetPositions = new Float32Array(particleCount * 3)

    // Initial random positions
    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 120
      positions[i + 1] = (Math.random() - 0.5) * 120
      positions[i + 2] = (Math.random() - 0.5) * 120
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    // Particle Material
    const material = new THREE.PointsMaterial({
      size: 3.5,
      color: 0xECD803, // Pure Yellow theme
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    })

    const particleSystem = new THREE.Points(geometry, material)
    scene.add(particleSystem)

    // Connecting Lines for Neural Vector feel
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xECD803,
      transparent: true,
      opacity: 0.15,
    })
    const lineGeometry = new THREE.BufferGeometry()
    const lineMesh = new THREE.LineSegments(lineGeometry, lineMaterial)
    scene.add(lineMesh)

    // Function to calculate target shapes per stage
    const updateTargets = (currentStage) => {
      for (let i = 0; i < particleCount; i++) {
        const idx = i * 3

        if (currentStage === 1) {
          // Stage 1: Floating Sphere Ring (Fetching)
          const u = Math.random()
          const v = Math.random()
          const theta = u * 2.0 * Math.PI
          const phi = Math.acos(2.0 * v - 1.0)
          const r = 45
          targetPositions[idx] = r * Math.sin(phi) * Math.cos(theta)
          targetPositions[idx + 1] = r * Math.sin(phi) * Math.sin(theta)
          targetPositions[idx + 2] = r * Math.cos(phi)
        } else if (currentStage === 2) {
          // Stage 2: 3 Cluster Blocks (Chunking)
          const cluster = i % 3
          const offsetX = (cluster - 1) * 35
          targetPositions[idx] = offsetX + (Math.random() - 0.5) * 20
          targetPositions[idx + 1] = (Math.random() - 0.5) * 20
          targetPositions[idx + 2] = (Math.random() - 0.5) * 20
        } else if (currentStage === 3) {
          // Stage 3: Scattered Vector Neural Network (Embeddings)
          targetPositions[idx] = (Math.random() - 0.5) * 90
          targetPositions[idx + 1] = (Math.random() - 0.5) * 90
          targetPositions[idx + 2] = (Math.random() - 0.5) * 90
        } else {
          // Stage 4: Structured 3D Matrix Cube (Vector DB Ready)
          const side = Math.cbrt(particleCount)
          const x = (i % side) - side / 2
          const y = (Math.floor(i / side) % side) - side / 2
          const z = (Math.floor(i / (side * side)) % side) - side / 2
          const spacing = 12
          targetPositions[idx] = x * spacing
          targetPositions[idx + 1] = y * spacing
          targetPositions[idx + 2] = z * spacing
        }
      }
    }

    updateTargets(stage)

    // Animation Loop
    let animationFrameId
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate)

      const pos = geometry.attributes.position.array
      const lerpSpeed = 0.05 // Smooth transition between stages

      // Interpolate particles towards target positions
      for (let i = 0; i < particleCount * 3; i++) {
        pos[i] += (targetPositions[i] - pos[i]) * lerpSpeed
      }
      geometry.attributes.position.needsUpdate = true

      // Slow rotation
      particleSystem.rotation.y += 0.008
      particleSystem.rotation.x += 0.003

      // Update Lines connecting nearby particles in Stage 3
      if (stage === 3) {
        const linePos = []
        for (let i = 0; i < 40; i++) {
          const a = Math.floor(Math.random() * particleCount) * 3
          const b = Math.floor(Math.random() * particleCount) * 3
          linePos.push(pos[a], pos[a + 1], pos[a + 2])
          linePos.push(pos[b], pos[b + 1], pos[b + 2])
        }
        lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3))
        lineMesh.visible = true
      } else {
        lineMesh.visible = false
      }

      renderer.render(scene, camera)
    }

    animate()

    // Clean up WebGL resources
    return () => {
      cancelAnimationFrame(animationFrameId)
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
      geometry.dispose()
      material.dispose()
      lineGeometry.dispose()
      lineMaterial.dispose()
      renderer.dispose()
    }
  }, [stage])

  return (
    <div style={{
      width: '100%',
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-md)',
      padding: '12px 16px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 10,
      margin: '12px 0',
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    }}>
      {/* Stage Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
          {stage < 4 ? (
            <Loader2Icon size={14} style={{ animation: 'spin 0.8s linear infinite' }} />
          ) : (
            <CheckCircle2Icon size={14} color="var(--success)" />
          )}
          <span>{indexingMsg}</span>
        </div>
        <span style={{
          fontSize: 10, fontFamily: 'var(--font-mono)',
          color: 'var(--text-muted)', background: 'var(--bg-surface)',
          padding: '2px 8px', borderRadius: 12, border: '1px solid var(--border)',
        }}>
          Stage {stage}/4
        </span>
      </div>

      {/* 3D Canvas Container */}
      <div ref={containerRef} style={{ width: '100%', height: 180, position: 'relative' }} />

      {/* RAG Pipeline Steps Indicator */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, width: '100%', marginTop: 4 }}>
        {[
          { step: 1, label: 'Transcript' },
          { step: 2, label: 'Chunking' },
          { step: 3, label: 'Embedding' },
          { step: 4, label: 'Pinecone DB' },
        ].map(s => (
          <div key={s.step} style={{
            textAlign: 'center', padding: '4px',
            borderRadius: 6, fontSize: 10, fontWeight: 600,
            background: stage >= s.step ? 'var(--accent-soft)' : 'var(--bg-surface)',
            color: stage >= s.step ? 'var(--accent)' : 'var(--text-muted)',
            border: `1px solid ${stage >= s.step ? 'var(--border-strong)' : 'transparent'}`,
            transition: 'all 0.2s',
          }}>
            {s.label}
          </div>
        ))}
      </div>
    </div>
  )
}