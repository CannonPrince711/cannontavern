import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { RollResult } from '@shared/types'

/**
 * Optional 3D dice (Settings → Appearance → 3D dice). Each die is a tumbling
 * polyhedron that eases to rest; the result is shown on a face label. This is
 * lazy-loaded, so three.js costs nothing unless the setting is on.
 */
function geometryFor(sides: number): THREE.BufferGeometry {
  switch (sides) {
    case 4:
      return new THREE.TetrahedronGeometry(0.9)
    case 6:
      return new THREE.BoxGeometry(1.1, 1.1, 1.1)
    case 8:
      return new THREE.OctahedronGeometry(0.85)
    case 12:
      return new THREE.DodecahedronGeometry(0.85)
    case 20:
      return new THREE.IcosahedronGeometry(0.9)
    default:
      return new THREE.ConeGeometry(0.85, 1.3, 10) // d10 / d100 stand-in
  }
}

function labelTexture(text: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = color
  g.font = 'bold 64px Cinzel, Georgia, serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, 64, 68)
  return new THREE.CanvasTexture(c)
}

export default function Dice3D({ result }: { result: RollResult }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const css = getComputedStyle(document.documentElement)
    const gold = css.getPropertyValue('--gold').trim() || '#c9a227'
    const surface = css.getPropertyValue('--surface-2').trim() || '#211d26'
    const crimson = css.getPropertyValue('--crimson').trim() || '#e5484d'
    const fg = css.getPropertyValue('--foreground').trim() || '#ece6dc'

    const dice = result.dice.slice(0, 8)
    const width = Math.min(560, 140 * dice.length + 40)
    const height = 220
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(width, height)
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100)
    camera.position.set(0, 0, 7.5)
    scene.add(new THREE.AmbientLight(0xffffff, 0.55))
    const key = new THREE.DirectionalLight(0xffffff, 1.2)
    key.position.set(3, 4, 5)
    scene.add(key)

    const meshes = dice.map((d, i) => {
      const crit = d.sides === 20 && result.crit && d.value === 20
      const fumble = d.sides === 20 && result.fumble && d.value === 1
      const mat = new THREE.MeshStandardMaterial({
        color: crit ? gold : fumble ? crimson : surface,
        metalness: 0.35,
        roughness: 0.45,
        flatShading: true,
        transparent: !d.kept,
        opacity: d.kept ? 1 : 0.35
      })
      const mesh = new THREE.Mesh(geometryFor(d.sides), mat)
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: gold }))
      mesh.add(edges)
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(String(d.value), crit || fumble ? '#1a1405' : fg), depthTest: false }))
      label.scale.set(0.9, 0.9, 1)
      label.visible = false
      mesh.add(label)
      const x = (i - (dice.length - 1) / 2) * 1.7
      mesh.position.set(x, 3.5, 0)
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)
      scene.add(mesh)
      return { mesh, label, x, spin: new THREE.Vector3(8 + Math.random() * 6, 6 + Math.random() * 6, 4 + Math.random() * 4) }
    })

    const start = performance.now()
    let frame = 0
    const tick = (): void => {
      const t = Math.min(1, (performance.now() - start) / 1400)
      const ease = 1 - Math.pow(1 - t, 3)
      for (const m of meshes) {
        // Fall with a small bounce, spin slowing to a stop.
        const bounce = t < 0.7 ? 3.5 * (1 - ease) : Math.abs(Math.sin((t - 0.7) * 10)) * 0.15 * (1 - t)
        m.mesh.position.y = bounce
        m.mesh.rotation.x += (m.spin.x * (1 - ease)) / 60
        m.mesh.rotation.y += (m.spin.y * (1 - ease)) / 60
        m.mesh.rotation.z += (m.spin.z * (1 - ease)) / 60
        if (t >= 1) {
          m.label.visible = true
          m.label.position.set(0, 0, 1)
          m.mesh.quaternion.slerp(new THREE.Quaternion(), 0.15)
        }
      }
      renderer.render(scene, camera)
      if (t < 1 || meshes.some((m) => m.mesh.quaternion.angleTo(new THREE.Quaternion()) > 0.01)) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      renderer.dispose()
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose()
      })
      el.removeChild(renderer.domElement)
    }
  }, [result])

  return <div ref={host} aria-hidden />
}
