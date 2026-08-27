import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { Loader2Icon } from 'lucide-react'

export function RAGPipeline3D({ stage = 1, indexingMsg = 'Processing video...' }) {
  const containerRef = useRef(null)
  const wrapperRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    const wrapper = wrapperRef.current
    if (!container || !wrapper) return

    // 1. Setup Camera based on the Chat Area container (NOT window)
    let width = wrapper.clientWidth
    let height = wrapper.clientHeight

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
    camera.position.z = 220 // Adjusted for chat area size

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    // Handle container resize dynamically
    const handleResize = () => {
      if (!wrapper) return
      width = wrapper.clientWidth
      height = wrapper.clientHeight
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    window.addEventListener('resize', handleResize)

    // 2. Create Particle System
    const particleCount = 450
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(particleCount * 3)
    const targetPositions = new Float32Array(particleCount * 3)

    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 180
      positions[i + 1] = (Math.random() - 0.5) * 180
      positions[i + 2] = (Math.random() - 0.5) * 180
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    const material = new THREE.PointsMaterial({
      size: 3.5,
      color: 0xECD803,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
    })

    const particleSystem = new THREE.Points(geometry, material)
    scene.add(particleSystem)

    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xECD803,
      transparent: true,
      opacity: 0.15,
    })
    const lineGeometry = new THREE.BufferGeometry()
    const lineMesh = new THREE.LineSegments(lineGeometry, lineMaterial)
    scene.add(lineMesh)

    const updateTargets = (currentStage) => {
      for (let i = 0; i < particleCount; i++) {
        const idx = i * 3
        if (currentStage === 1) {
          const u = Math.random(), v = Math.random()
          const theta = u * 2.0 * Math.PI, phi = Math.acos(2.0 * v - 1.0), r = 55
          targetPositions[idx] = r * Math.sin(phi) * Math.cos(theta)
          targetPositions[idx + 1] = r * Math.sin(phi) * Math.sin(theta)
          targetPositions[idx + 2] = r * Math.cos(phi)
        } else if (currentStage === 2) {
          const cluster = i % 3
          const offsetX = (cluster - 1) * 45
          targetPositions[idx] = offsetX + (Math.random() - 0.5) * 25
          targetPositions[idx + 1] = (Math.random() - 0.5) * 25
          targetPositions[idx + 2] = (Math.random() - 0.5) * 25
        } else if (currentStage === 3) {
          targetPositions[idx] = (Math.random() - 0.5) * 120
          targetPositions[idx + 1] = (Math.random() - 0.5) * 120
          targetPositions[idx + 2] = (Math.random() - 0.5) * 120
        } else {
          const side = Math.cbrt(particleCount)
          const x = (i % side) - side / 2
          const y = (Math.floor(i / side) % side) - side / 2
          const z = (Math.floor(i / (side * side)) % side) - side / 2
          const spacing = 16
          targetPositions[idx] = x * spacing
          targetPositions[idx + 1] = y * spacing
          targetPositions[idx + 2] = z * spacing
        }
      }
    }

    updateTargets(stage)

    let animationFrameId
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate)
      const pos = geometry.attributes.position.array
      const lerpSpeed = 0.05

      for (let i = 0; i < particleCount * 3; i++) {
        pos[i] += (targetPositions[i] - pos[i]) * lerpSpeed
      }
      geometry.attributes.position.needsUpdate = true

      particleSystem.rotation.y += 0.005
      particleSystem.rotation.x += 0.002

      if (stage === 3) {
        const linePos = []
        for (let i = 0; i < 50; i++) {
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

    return () => {
      window.removeEventListener('resize', handleResize)
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
    <div 
      ref={wrapperRef} 
      style={{
        position: 'absolute',
        inset: 0, // Fits exactly inside the Chat Area parent container
        background: 'var(--bg-base)', 
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
        overflow: 'hidden'
      }}
    >
      {/* Dynamic Text Intimation overlaid on the animation */}
      <div style={{
        position: 'absolute',
        bottom: '25%', // Placed elegantly below the 3D sphere
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        zIndex: 20,
        pointerEvents: 'none'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--accent)' }}>
          <Loader2Icon size={20} style={{ animation: 'spin 1s linear infinite' }} />
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, letterSpacing: '0.02em' }}>
            {indexingMsg}
          </h2>
        </div>
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
          Preparing vector embeddings for semantic search...
        </p>
      </div>

      {/* 3D Canvas Container */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}