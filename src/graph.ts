import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import {
  EDGE_KINDS,
  type CodeMap,
  type EdgeKind,
  type MapNode,
  type ViewState,
  type RemoteViewCommand,
  type RemoteViewResult,
} from "../shared/types";
import { pickNodeAtPixel } from "./picking";
import { graphDetail, DETAIL_LIMITS, type GraphDetail } from "./graph-detail";
import {
  defaultRenderSettings,
  PerformanceMonitor,
  type RenderSettings,
  type RenderStatus,
} from "./render-settings";

export class GraphScene {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private renderSettings = { ...defaultRenderSettings };
  private reduced = false;
  private glowActive = true;
  private performanceMonitor = new PerformanceMonitor();
  private lastFrame = 0;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100000);
  private controls: OrbitControls;
  private labels: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private resize: ResizeObserver;
  private frame = 0;
  private map: CodeMap | null = null;
  private points: THREE.Points | null = null;
  private lines = new Map<EdgeKind, THREE.LineSegments>();
  private highlight: THREE.LineSegments | null = null;
  private index = new Map<string, number>();
  private detail: GraphDetail | null = null;
  private drawnNodes: number[] = [];
  private connected = new Set<string>();
  private detailDirty = true;
  private lastDetailTime = 0;
  private interacting = false;
  private lastCameraChange = 0;
  private detailMoving = false;
  private active = true;
  private drawnEdges = 0;
  private statusKey = "";
  private selected: string | null = null;
  private emphasized = new Set<string>();
  private visibleEdges = new Set<EdgeKind>(EDGE_KINDS);
  private showLabels = true;
  private animation?: {
    start: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
  };
  private labelTargets: {
    index: number;
    bounds: [number, number, number, number];
  }[] = [];
  private pointerStart = { x: 0, y: 0 };
  private hover: number | null = null;
  private labelCandidates: number[] = [];
  private lastLabelTime = 0;
  private labelCount = 0;
  private width = 1;
  private height = 1;
  private zoomLevel = 1;
  private disposed = false;
  private dirty = true;
  private lastPick = 0;
  private invalidate = () => {
    this.dirty = true;
    this.detailDirty = true;
  };
  private cameraChanged = () => {
    this.lastCameraChange = performance.now();
    this.invalidate();
  };
  constructor(
    private host: HTMLElement,
    private onSelect: (id: string | null) => void,
    private onHover: (node: MapNode | null, x: number, y: number) => void,
    private onZoom: (level: number, labels: number) => void,
    private onRenderStatus: (status: RenderStatus) => void = () => {},
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.domElement.className = "graph-canvas";
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D code map. Drag to orbit, right-drag to pan, scroll to zoom, and click to select.",
    );
    this.renderer.domElement.tabIndex = 0;
    host.append(this.renderer.domElement);
    this.labels = document.createElement("canvas");
    this.labels.className = "label-canvas";
    this.labels.setAttribute("aria-hidden", "true");
    host.append(this.labels);
    this.context = this.labels.getContext("2d")!;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.55;
    this.controls.panSpeed = 0.65;
    this.controls.zoomSpeed = 0.8;
    this.controls.addEventListener("start", this.stopAnimation);
    this.controls.addEventListener("start", this.startInteraction);
    this.controls.addEventListener("end", this.endInteraction);
    this.controls.addEventListener("change", this.cameraChanged);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.72, 0.42, 0.18);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize = new ResizeObserver(this.resizeCanvas);
    this.resize.observe(host);
    this.renderer.domElement.addEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.addEventListener("pointermove", this.pointerMove);
    this.renderer.domElement.addEventListener(
      "pointerleave",
      this.pointerLeave,
    );
    this.resizeCanvas();
    this.tick();
  }
  private stopAnimation = () => {
    this.animation = undefined;
  };
  private startInteraction = () => {
    this.interacting = true;
    this.invalidate();
  };
  private endInteraction = () => {
    this.interacting = false;
    this.lastDetailTime = 0;
    this.invalidate();
  };
  private resizeCanvas = () => {
    this.dirty = true;
    this.detailDirty = true;
    this.lastDetailTime = 0;
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(this.width, this.height);
    this.composer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.labels.width = this.width * dpr;
    this.labels.height = this.height * dpr;
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  load(map: CodeMap, nodeIds: string[] | null = null) {
    this.dirty = true;
    this.clear();
    this.map = map;
    this.selected = null;
    this.performanceMonitor.reset(performance.now());
    this.lastFrame = 0;
    this.detail = graphDetail(map);
    this.index = this.detail.byId;
    this.detail.setScope(nodeIds);
    this.detailDirty = true;
    this.lastDetailTime = 0;
    const pixelRatio = Math.min(
      window.devicePixelRatio,
      map.nodes.length > 10000 || map.edges.length > 50000 ? 1.25 : 2,
    );
    this.renderer.setPixelRatio(pixelRatio);
    this.composer.setPixelRatio(pixelRatio);
    const positions = new Float32Array(DETAIL_LIMITS.nodes * 3),
      sizes = new Float32Array(DETAIL_LIMITS.nodes),
      brightness = new Float32Array(DETAIL_LIMITS.nodes);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute(
      "aBrightness",
      new THREE.BufferAttribute(brightness, 1),
    );
    geometry.setDrawRange(0, 0);
    for (const attribute of Object.values(geometry.attributes))
      (attribute as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uScale: { value: map.layout.radius * 4.1 },
        uPixelRatio: { value: pixelRatio },
        uGlow: {
          value: this.glowActive ? this.renderSettings.glowStrength / 0.72 : 0,
        },
      },
      vertexShader: `attribute float aSize; attribute float aBrightness; uniform float uScale; uniform float uPixelRatio; varying float vBrightness;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vBrightness = aBrightness;
        gl_PointSize = clamp(aSize * uPixelRatio * uScale / max(1.0, -mv.z), 1.0, 65.0 * uPixelRatio); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vBrightness; uniform float uGlow;
        void main() { float d = length(gl_PointCoord - vec2(0.5)) * 2.0; if(d > 1.0) discard;
        float core = exp(-d*d*48.0); float halo = exp(-d*5.8) * 0.36 * uGlow;
        vec3 amber = mix(vec3(1.0, 0.27, 0.025), vec3(1.0, 0.78, 0.32), core);
        gl_FragColor = vec4(amber * (0.7 + core), (core + halo) * vBrightness); }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    for (const kind of EDGE_KINDS) {
      const vertices = new Float32Array(DETAIL_LIMITS.edges * 6);
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        "position",
        new THREE.BufferAttribute(vertices, 3).setUsage(THREE.DynamicDrawUsage),
      );
      g.setDrawRange(0, 0);
      const line = new THREE.LineSegments(
        g,
        new THREE.LineBasicMaterial({
          color: 0xea6b19,
          transparent: true,
          opacity: kind === "contains" ? 0.19 : 0.12,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: false,
        }),
      );
      line.frustumCulled = false;
      this.lines.set(kind, line);
      this.scene.add(line);
    }
    const highlightGeometry = new THREE.BufferGeometry();
    highlightGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array(DETAIL_LIMITS.edges * 6),
        3,
      ).setUsage(THREE.DynamicDrawUsage),
    );
    highlightGeometry.setDrawRange(0, 0);
    this.highlight = new THREE.LineSegments(
      highlightGeometry,
      new THREE.LineBasicMaterial({
        color: 0xffb05d,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.highlight.frustumCulled = false;
    this.scene.add(this.highlight);
    this.controls.minDistance = map.layout.radius * 0.025;
    this.controls.maxDistance = map.layout.radius * 14;
    this.camera.near = Math.max(0.01, map.layout.radius * 0.0005);
    this.camera.far = map.layout.radius * 60;
    this.camera.updateProjectionMatrix();
    if (map.view) {
      this.visibleEdges = new Set(map.view.visibleEdges);
      this.showLabels = map.view.labels;
      this.camera.position.fromArray(map.view.position);
      this.controls.target.fromArray(map.view.target);
      this.setSelected(map.view.selected);
      this.setEdges(map.view.visibleEdges);
    } else {
      this.visibleEdges = new Set(EDGE_KINDS);
      this.showLabels = true;
      this.fit(false);
    }
    this.controls.update();
  }
  fit(animate = true) {
    if (!this.map) return;
    const r = this.map.layout.radius;
    const aspectScale = Math.max(1, 1 / this.camera.aspect);
    const direction = new THREE.Vector3(0.16, 0.09, 1).normalize();
    const to = direction.multiplyScalar(r * 3.15 * aspectScale);
    this.move(to, new THREE.Vector3(), animate);
  }
  private move(to: THREE.Vector3, target: THREE.Vector3, animate = true) {
    if (
      animate &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      this.animation = {
        start: performance.now(),
        from: this.camera.position.clone(),
        to,
        fromTarget: this.controls.target.clone(),
        toTarget: target,
      };
    else {
      this.camera.position.copy(to);
      this.controls.target.copy(target);
      this.controls.update();
    }
  }
  focus(id: string, animate = true) {
    if (!this.map || !this.index.has(id)) return;
    const node = this.map.nodes[this.index.get(id)!],
      target = new THREE.Vector3(...node.position);
    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    this.move(
      target.clone().addScaledVector(direction, this.map.layout.radius * 0.44),
      target,
      animate,
    );
    this.setSelected(id);
  }
  setSelected(id: string | null) {
    this.dirty = true;
    this.selected = id;
    this.emphasized.clear();
    this.refreshEmphasis();
  }
  private refreshEmphasis() {
    this.invalidate();
    const anchors = new Set(this.selected ? [this.selected] : this.emphasized);
    this.connected.clear();
    for (const id of anchors)
      for (const neighbor of this.detail?.neighbors(id) ?? [])
        this.connected.add(neighbor);
    for (const [kind, line] of this.lines)
      (line.material as THREE.LineBasicMaterial).opacity = anchors.size
        ? 0.027
        : kind === "contains"
          ? 0.19
          : 0.12;
    this.updateHighlight();
  }
  private updateHighlight() {
    this.invalidate();
  }
  setScope(ids: string[] | null) {
    this.detail?.setScope(ids);
    this.lastDetailTime = 0;
    this.invalidate();
  }
  setActive(active: boolean) {
    this.active = active;
    if (active) {
      this.lastFrame = 0;
      this.invalidate();
    }
  }
  private updateDetail(now: number, moving: boolean) {
    if (!this.map || !this.detail || !this.points || !this.highlight) return;
    const anchors = new Set(this.selected ? [this.selected] : this.emphasized);
    const plan = this.detail.plan(
      this.camera,
      this.width,
      this.height,
      this.visibleEdges,
      anchors,
      moving,
    );
    this.drawnNodes = plan.nodes;
    this.drawnEdges = plan.edges.length;
    this.labelCandidates = plan.nodes.slice(0, moving ? 400 : 1000);
    const geometry = this.points.geometry;
    const positions = geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const sizes = geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const brightness = geometry.getAttribute(
      "aBrightness",
    ) as THREE.BufferAttribute;
    plan.nodes.forEach((index, slot) => {
      const node = this.map!.nodes[index];
      (positions.array as Float32Array).set(node.position, slot * 3);
      sizes.setX(
        slot,
        (node.kind === "folder" ? 9 : node.kind === "file" ? 7 : 4.6) +
          Math.log2(node.degree + 1) * 1.25,
      );
      brightness.setX(
        slot,
        !anchors.size
          ? node.status === "unsupported" || node.status === "skipped"
            ? 0.38
            : 1
          : anchors.has(node.id)
            ? 2
            : this.connected.has(node.id)
              ? 1
              : 0.12,
      );
    });
    geometry.setDrawRange(0, plan.nodes.length);
    for (const attribute of [positions, sizes, brightness]) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, plan.nodes.length * attribute.itemSize);
      attribute.needsUpdate = true;
    }
    const counts = new Map<THREE.LineSegments, number>();
    for (const line of this.lines.values()) counts.set(line, 0);
    counts.set(this.highlight, 0);
    for (const index of plan.edges) {
      const edge = this.map.edges[index];
      const line =
        anchors.has(edge.source) || anchors.has(edge.target)
          ? this.highlight
          : this.lines.get(edge.kind)!;
      const count = counts.get(line)!;
      const vertices = line.geometry.getAttribute("position")
        .array as Float32Array;
      vertices.set(
        this.map.nodes[this.index.get(edge.source)!].position,
        count * 6,
      );
      vertices.set(
        this.map.nodes[this.index.get(edge.target)!].position,
        count * 6 + 3,
      );
      counts.set(line, count + 1);
    }
    for (const [line, count] of counts) {
      line.geometry.setDrawRange(0, count * 2);
      const attribute = line.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, count * 6);
      attribute.needsUpdate = true;
    }
    this.detailMoving = moving;
    this.detailDirty = false;
    this.lastDetailTime = now;
    this.lastLabelTime = 0;
    this.emitStatus();
  }
  setEdges(kinds: EdgeKind[]) {
    this.dirty = true;
    this.visibleEdges = new Set(kinds);
    for (const [kind, line] of this.lines)
      line.visible = this.visibleEdges.has(kind);
    this.updateHighlight();
  }
  setLabels(visible: boolean) {
    this.dirty = true;
    this.showLabels = visible;
  }
  setRendering(settings: RenderSettings) {
    this.renderSettings = { ...settings };
    this.reduced = false;
    this.performanceMonitor.reset(performance.now());
    this.updateRendering();
  }
  restoreGlow() {
    this.reduced = false;
    this.performanceMonitor.reset(performance.now());
    this.updateRendering();
  }
  private updateRendering() {
    this.dirty = true;
    this.glowActive =
      this.renderSettings.glowEnabled &&
      this.renderSettings.glowStrength > 0 &&
      !this.reduced;
    // Keep the scene on the same offscreen target in both modes. Rendering it
    // directly to the antialiased canvas changes MSAA and output conversion,
    // which can make the ostensibly cheaper glow-off path more expensive.
    this.bloom.enabled = this.glowActive;
    this.bloom.strength = this.renderSettings.glowStrength;
    if (this.points)
      (this.points.material as THREE.ShaderMaterial).uniforms.uGlow.value = this
        .glowActive
        ? this.renderSettings.glowStrength / 0.72
        : 0;
    this.emitStatus();
  }
  private emitStatus() {
    const status = {
      glowActive: this.glowActive,
      reduced: this.reduced,
      visibleNodes: this.drawnNodes?.length ?? 0,
      visibleConnections: this.drawnEdges ?? 0,
      totalNodes: this.map?.nodes.length ?? 0,
      totalConnections: this.map?.edges.length ?? 0,
    };
    const key = JSON.stringify(status);
    if (key !== this.statusKey) {
      this.statusKey = key;
      this.onRenderStatus(status);
    }
  }
  zoom(amount: number) {
    const direction = this.camera.position.clone().sub(this.controls.target);
    direction.multiplyScalar(amount);
    direction.clampLength(this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).add(direction);
    this.controls.update();
  }
  capture(): ViewState {
    return {
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      selected: this.selected,
      visibleEdges: [...this.visibleEdges],
      labels: this.showLabels,
    };
  }
  restore(view: ViewState) {
    this.stopAnimation();
    this.camera.position.fromArray(view.position);
    this.controls.target.fromArray(view.target);
    this.setSelected(
      view.selected && this.index.has(view.selected) ? view.selected : null,
    );
    this.setEdges(view.visibleEdges);
    this.setLabels(view.labels);
    this.controls.update();
    this.invalidate();
  }
  applyRemote(command: RemoteViewCommand): RemoteViewResult {
    if (!this.map)
      throw new Error(
        "The visualization is not ready. Open a project or map first.",
      );
    if (
      (command.node_id && !this.index.has(command.node_id)) ||
      command.node_ids?.some((id) => !this.index.has(id))
    )
      throw new Error(
        "The requested node is not in the current visualization.",
      );
    if (command.action !== "inspect") this.stopAnimation();
    switch (command.action) {
      case "focus":
        this.focus(command.node_id!, false);
        break;
      case "select":
        this.setSelected(command.node_id!);
        break;
      case "highlight":
        this.selected = null;
        this.emphasized = new Set(command.node_ids);
        this.refreshEmphasis();
        break;
      case "clear":
        this.setSelected(null);
        break;
      case "fit":
        this.fit(false);
        break;
      case "zoom":
        this.zoom(command.factor!);
        break;
      case "layers":
        if (command.edge_kinds) this.setEdges(command.edge_kinds);
        if (command.labels !== undefined) this.setLabels(command.labels);
        break;
    }
    return { view: this.capture(), highlighted_node_ids: [...this.emphasized] };
  }
  private hit(event: PointerEvent): number | null {
    if (!this.points || !this.map) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = event.clientX - rect.left,
      y = event.clientY - rect.top;
    const point = pickNodeAtPixel(
      this.map.nodes,
      this.camera,
      rect.width,
      rect.height,
      x,
      y,
      this.map.layout.radius,
      this.drawnNodes,
    );
    if (point !== null) return point;
    // Visible names are also selection targets, so small symbols are accessible.
    return (
      this.labelTargets.find(
        ({ bounds: b }) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3],
      )?.index ?? null
    );
  }
  private pointerDown = (e: PointerEvent) => {
    this.pointerStart = { x: e.clientX, y: e.clientY };
  };
  private pointerUp = (e: PointerEvent) => {
    if (
      e.button !== 0 ||
      Math.hypot(
        e.clientX - this.pointerStart.x,
        e.clientY - this.pointerStart.y,
      ) > 5
    )
      return;
    const index = this.hit(e),
      id = index === null ? null : this.map!.nodes[index].id;
    this.onSelect(id);
    if (id) this.focus(id);
    else this.setSelected(null);
  };
  private pointerMove = (e: PointerEvent) => {
    if (e.buttons || performance.now() - this.lastPick < 40) return;
    this.lastPick = performance.now();
    const hit = this.hit(e);
    this.hover = hit;
    this.renderer.domElement.style.cursor = hit === null ? "grab" : "pointer";
    const rect = this.host.getBoundingClientRect();
    this.onHover(
      hit === null ? null : this.map!.nodes[hit],
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
  };
  private pointerLeave = () => {
    this.hover = null;
    this.onHover(null, 0, 0);
  };
  private drawLabels(now: number) {
    if (now - this.lastLabelTime < 60) return;
    this.lastLabelTime = now;
    const ctx = this.context;
    ctx.clearRect(0, 0, this.width, this.height);
    this.labelTargets = [];
    if (!this.map) return;
    const r = this.map.layout.radius,
      distance = this.camera.position.distanceTo(this.controls.target);
    const zoom = distance / (r * 3.15 * Math.max(1, 1 / this.camera.aspect));
    this.zoomLevel = zoom;
    const wideOpacity = THREE.MathUtils.clamp((0.9 - zoom) / 0.22, 0, 1);
    if (!this.showLabels || wideOpacity <= 0) {
      this.labelCount = 0;
      this.onZoom(zoom, 0);
      return;
    }
    const candidates =
      this.selected &&
      this.index.has(this.selected) &&
      this.drawnNodes.includes(this.index.get(this.selected)!)
        ? [
            this.index.get(this.selected)!,
            ...this.labelCandidates.filter(
              (i) => this.map!.nodes[i].id !== this.selected,
            ),
          ]
        : this.labelCandidates;
    const rectangles: [number, number, number, number][] = [];
    const projected = new THREE.Vector3(),
      world = new THREE.Vector3(),
      direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    let drawn = 0;
    for (const index of candidates) {
      const node = this.map.nodes[index],
        active = node.id === this.selected;
      world.fromArray(node.position);
      const localDistance = world.distanceTo(this.camera.position) / r;
      const level =
        node.kind === "folder" ? 3.3 : node.kind === "file" ? 2.65 : 1.45;
      let alpha =
        THREE.MathUtils.clamp((level - localDistance) / 0.52, 0, 1) *
        wideOpacity;
      if (active) alpha = wideOpacity;
      if (alpha <= 0.03) continue;
      if (
        (world.x - this.camera.position.x) * direction.x +
          (world.y - this.camera.position.y) * direction.y +
          (world.z - this.camera.position.z) * direction.z <=
        0
      )
        continue;
      projected.copy(world).project(this.camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const x = (projected.x * 0.5 + 0.5) * this.width + 8,
        y = (-projected.y * 0.5 + 0.5) * this.height;
      if (x < 8 || y < 22 || x > this.width - 20 || y > this.height - 15)
        continue;
      const label =
        node.name.length > 40 ? node.name.slice(0, 38) + "…" : node.name;
      ctx.font = `${active || node.kind === "folder" ? "500" : "400"} ${active ? 12 : 11}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      const width = ctx.measureText(label).width + 12;
      const box: [number, number, number, number] = [
        x - 4,
        y - 11,
        x + width,
        y + 7,
      ];
      if (
        !active &&
        rectangles.some(
          (b) =>
            box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1],
        )
      )
        continue;
      rectangles.push(box);
      ctx.globalAlpha =
        alpha *
        (this.selected && !active && !this.connected.has(node.id) ? 0.5 : 1);
      if (ctx.globalAlpha > 0.15)
        this.labelTargets.push({ index, bounds: box });
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "#000";
      ctx.lineJoin = "round";
      ctx.strokeText(label, x, y);
      ctx.fillStyle = active
        ? "#fff2da"
        : node.kind === "folder"
          ? "#e2d3bd"
          : "#c7b99f";
      ctx.fillText(label, x, y);
      if (++drawn >= 90) break;
    }
    ctx.globalAlpha = 1;
    this.labelCount = drawn;
    this.onZoom(zoom, drawn);
  }
  private tick = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    if (!this.active) return;
    const now = performance.now();
    if (
      this.lastFrame &&
      this.dirty &&
      this.map &&
      this.glowActive &&
      this.renderSettings.autoPerformance
    ) {
      const slow = this.performanceMonitor.sample(
        now - this.lastFrame,
        now,
        document.visibilityState === "visible" && document.hasFocus(),
      );
      if (slow) {
        this.reduced = true;
        this.updateRendering();
      }
    }
    this.lastFrame = now;
    if (this.animation) {
      const t = Math.min(1, (now - this.animation.start) / 850),
        eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.position.lerpVectors(
        this.animation.from,
        this.animation.to,
        eased,
      );
      this.controls.target.lerpVectors(
        this.animation.fromTarget,
        this.animation.toTarget,
        eased,
      );
      if (t === 1) this.animation = undefined;
    }
    this.controls.update();
    const moving =
      this.interacting || !!this.animation || now - this.lastCameraChange < 100;
    if (this.detailMoving && !moving) this.invalidate();
    if (this.detailDirty && (!moving || now - this.lastDetailTime >= 100))
      this.dirty = true;
    if (this.dirty && document.visibilityState === "visible") {
      if (this.detailDirty && (!moving || now - this.lastDetailTime >= 100))
        this.updateDetail(now, moving);
      this.composer.render();
      if (!moving) this.lastLabelTime = 0;
      this.drawLabels(now);
      this.dirty = false;
    }
  };
  private clear() {
    this.animation = undefined;
    this.index = new Map();
    this.connected.clear();
    this.drawnNodes = [];
    this.drawnEdges = 0;
    this.detail = null;
    this.emphasized.clear();
    for (const item of [...this.scene.children]) {
      this.scene.remove(item);
      if (item instanceof THREE.Points || item instanceof THREE.LineSegments) {
        item.geometry.dispose();
        const materials = Array.isArray(item.material)
          ? item.material
          : [item.material];
        materials.forEach((m) => m.dispose());
      }
    }
    this.lines.clear();
    this.points = null;
    this.highlight = null;
    this.labelTargets = [];
    this.context.clearRect(0, 0, this.width, this.height);
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.clear();
    this.controls.removeEventListener("start", this.stopAnimation);
    this.controls.removeEventListener("start", this.startInteraction);
    this.controls.removeEventListener("end", this.endInteraction);
    this.controls.removeEventListener("change", this.cameraChanged);
    this.controls.dispose();
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this.pointerDown,
    );
    this.renderer.domElement.removeEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.removeEventListener(
      "pointermove",
      this.pointerMove,
    );
    this.renderer.domElement.removeEventListener(
      "pointerleave",
      this.pointerLeave,
    );
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.remove();
  }
}
