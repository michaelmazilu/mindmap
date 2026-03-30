/* global THREE */

class MindmapBrainWidget {
  constructor(container, options = {}) {
    this.container = container;
    this.width = options.width || 280;
    this.height = options.height || 180;
    this.regions = [];
    this.highlightedRegion = null;
    this.disposed = false;
    this._isDragging = false;
    this._lastPointerX = 0;
    this._lastPointerY = 0;
    this._camDist = 2.85;

    this._initScene();
    this._createBrainMesh();
    this._setupPointerOrbit();
    if (this.container) {
      this.container.title = 'Drag to orbit · scroll to zoom';
    }
    this._animate = this._animate.bind(this);
    this._animationId = requestAnimationFrame(this._animate);
  }

  _initScene() {
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(45, this.width / this.height, 0.1, 100);
    this.camera.position.set(-1.8, 0.4, 2.2);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.style.cursor = 'grab';
    this.renderer.domElement.style.touchAction = 'none';
    this.container.appendChild(this.renderer.domElement);

    this._updateCameraPosition();

    const ambient = new THREE.AmbientLight(0x404050, 0.6);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffeedd, 1.0);
    directional.position.set(3, 4, 2);
    this.scene.add(directional);

    const fill = new THREE.DirectionalLight(0x334466, 0.3);
    fill.position.set(-2, -1, -1);
    this.scene.add(fill);
  }

  _createBrainMesh() {
    const geo = this._generateBrainGeometry();
    const vertexCount = geo.attributes.position.count;

    const colors = new Float32Array(vertexCount * 3);
    const baseColor = new THREE.Color(0x2a2a2a);
    for (let i = 0; i < vertexCount; i++) {
      colors[i * 3] = baseColor.r;
      colors[i * 3 + 1] = baseColor.g;
      colors[i * 3 + 2] = baseColor.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      shininess: 20,
      specular: 0x222222,
      flatShading: true,
    });

    this.brainMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.brainMesh);

    this.brainGroup = new THREE.Group();
    this.scene.remove(this.brainMesh);
    this.brainGroup.add(this.brainMesh);

    const wireGeo = geo.clone();
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x1a1a1a,
      wireframe: true,
      transparent: true,
      opacity: 0.08,
    });
    this.wireframe = new THREE.Mesh(wireGeo, wireMat);
    this.brainGroup.add(this.wireframe);

    this.scene.add(this.brainGroup);
  }

  _updateCameraPosition() {
    const dir = this.camera.position.clone().normalize();
    if (dir.lengthSq() < 1e-6) dir.set(-0.62, 0.14, 0.77).normalize();
    this.camera.position.copy(dir.multiplyScalar(this._camDist));
    this.camera.lookAt(0, 0, 0);
  }

  _setupPointerOrbit() {
    const el = this.renderer.domElement;

    this._onPointerDown = (e) => {
      if (this.disposed || e.button !== 0) return;
      this._isDragging = true;
      this._lastPointerX = e.clientX;
      this._lastPointerY = e.clientY;
      el.style.cursor = 'grabbing';
      try {
        el.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
    };

    this._onPointerMove = (e) => {
      if (!this._isDragging || this.disposed) return;
      const dx = e.clientX - this._lastPointerX;
      const dy = e.clientY - this._lastPointerY;
      this._lastPointerX = e.clientX;
      this._lastPointerY = e.clientY;

      const yaw = dx * 0.006;
      const pitch = dy * 0.006;

      this.camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);

      const right = new THREE.Vector3();
      right.crossVectors(this.camera.position, this.camera.up).normalize();
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      this.camera.position.applyAxisAngle(right, -pitch);
      this._camDist = this.camera.position.length();
      this._camDist = Math.min(5.2, Math.max(1.35, this._camDist));
      this.camera.position.normalize().multiplyScalar(this._camDist);
      this.camera.lookAt(0, 0, 0);
    };

    this._onPointerUp = (e) => {
      this._isDragging = false;
      el.style.cursor = 'grab';
      try {
        el.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
    };

    this._onWheel = (e) => {
      if (this.disposed) return;
      e.preventDefault();
      const delta = e.deltaY * 0.0015;
      this._camDist = Math.min(5.2, Math.max(1.35, this._camDist + delta));
      this.camera.position.normalize().multiplyScalar(this._camDist);
      this.camera.lookAt(0, 0, 0);
    };

    el.addEventListener('pointerdown', this._onPointerDown);
    el.addEventListener('pointermove', this._onPointerMove);
    el.addEventListener('pointerup', this._onPointerUp);
    el.addEventListener('pointercancel', this._onPointerUp);
    el.addEventListener('lostpointercapture', this._onPointerUp);
    this._wheelOpts = { passive: false };
    el.addEventListener('wheel', this._onWheel, this._wheelOpts);
  }

  _generateBrainGeometry() {
    const base = new THREE.IcosahedronGeometry(1, 3);
    const positions = base.attributes.position;
    const vertex = new THREE.Vector3();

    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i);

      vertex.x *= 1.15;
      vertex.y *= 0.85;
      vertex.z *= 0.95;

      const fissureDepth = 0.06 * Math.sin(vertex.x * 8 + vertex.z * 4)
                         + 0.04 * Math.sin(vertex.y * 12 + vertex.x * 6)
                         + 0.03 * Math.sin(vertex.z * 15 + vertex.y * 8);

      const r = vertex.length();
      vertex.normalize().multiplyScalar(r + fissureDepth);

      const hemisphere = vertex.x > 0 ? 1 : -1;
      const midlineDip = Math.exp(-Math.pow(vertex.x, 2) * 20) * 0.12;
      vertex.y -= midlineDip;

      const frontalBulge = Math.max(0, -vertex.z - 0.3) * 0.15;
      vertex.z -= frontalBulge * 0.5;
      vertex.y += frontalBulge * 0.3;

      const occipitalBulge = Math.max(0, vertex.z - 0.3) * 0.1;
      vertex.z += occipitalBulge * 0.3;

      const temporalDrop = Math.max(0, -vertex.y - 0.2) * 0.15 *
        (1 - Math.exp(-Math.pow(vertex.x, 2) * 5));
      vertex.y -= temporalDrop;

      const gyri = 0.02 * Math.sin(vertex.x * 20 + vertex.y * 15)
                 + 0.015 * Math.sin(vertex.y * 25 + vertex.z * 18)
                 + 0.01 * Math.sin(vertex.z * 30 + vertex.x * 12);
      const r2 = vertex.length();
      vertex.normalize().multiplyScalar(r2 + gyri);

      positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }

    base.computeVertexNormals();
    return base;
  }

  setActivations(regions) {
    if (this.disposed) return;
    this.regions = regions || [];
    try {
      this._paintActivations();
    } catch (e) {
      console.warn('[Mindmap] _paintActivations', e);
    }
  }

  _paintActivations() {
    if (!this.brainMesh || !this.regions.length) return;

    const geo = this.brainMesh.geometry;
    const positions = geo.attributes.position;
    const colors = geo.attributes.color;
    const baseColor = new THREE.Color(0x2a2a2a);
    const vertex = new THREE.Vector3();

    const resolvedCenters = this.regions.map((reg) =>
      this._resolveActivationCenter(reg.name),
    );

    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i);

      let maxActivation = 0;
      let closestRegionIdx = -1;

      for (let r = 0; r < this.regions.length; r++) {
        const region = this.regions[r];
        const center = resolvedCenters[r];
        if (!center) continue;

        const dist = vertex.distanceTo(center);
        const spread = 0.6 + region.activation * 0.4;
        const influence = Math.exp(-dist * dist / (spread * spread * 0.3));
        const activation = region.activation * influence;

        if (activation > maxActivation) {
          maxActivation = activation;
          closestRegionIdx = r;
        }
      }

      const highlighted = this.highlightedRegion !== null &&
                          closestRegionIdx === this.highlightedRegion;

      const color = this._activationToColor(maxActivation, highlighted);

      if (maxActivation < 0.02) {
        colors.setXYZ(i, baseColor.r, baseColor.g, baseColor.b);
      } else {
        const blend = Math.min(1, maxActivation * 1.4);
        colors.setXYZ(
          i,
          baseColor.r * (1 - blend) + color.r * blend,
          baseColor.g * (1 - blend) + color.g * blend,
          baseColor.b * (1 - blend) + color.b * blend,
        );
      }
    }

    colors.needsUpdate = true;
  }

  /**
   * Map API region labels (Destrieux, shorthand, or common names) to a point
   * on the procedural brain so heat blobs appear. Unknown names get a stable
   * pseudo-random cortical point so color still varies per tweet.
   */
  _resolveActivationCenter(rawName) {
    const raw = (rawName || '').trim();
    if (!raw) return null;

    const norm = raw.toLowerCase().replace(/_/g, ' ');
    const map = this._getRegionCenters();

    if (map[rawName]) return map[rawName].clone();
    for (const key of Object.keys(map)) {
      const kl = key.toLowerCase();
      if (kl === norm) return map[key].clone();
      if (norm.includes(kl) || kl.includes(norm)) return map[key].clone();
    }

    const rules = [
      { re: /temporal|heschl|sts|transverse|s temporal|g temp| planum|mtg|stg|itg|fusiform|parahipp|hippoc|entorh|pole/, v: [0.72, -0.38, 0.12] },
      { re: /frontal|prefront|broca|pars|operc|orbitofront|olfactory|precentral|motor|supplement|sma|front/, v: [0.12, 0.42, -0.72] },
      { re: /occipital|calcar|lingual|cuneus|v1|v2|v3|visual|striate|extrastriate/, v: [0.05, 0.08, 0.88] },
      { re: /parietal|angular|supramarg|postcentral|somato|intrapariet|precuneus|sup par/, v: [-0.55, 0.48, 0.42] },
      { re: /cingul|cingulate|callos|medial.*wall/, v: [0.0, 0.22, -0.28] },
      { re: /insula|insular|claustrum/, v: [0.68, 0.05, -0.18] },
      { re: /amygdal|accumb|basal|striatum|pallid|putamen|thalamus|hypothal/, v: [0.52, -0.32, -0.15] },
      { re: /cerebell/, v: [0.0, -0.85, 0.65] },
      { re: /wernicke|language|comprehen/, v: [-0.68, 0.05, 0.28] },
    ];

    for (const { re, v } of rules) {
      if (re.test(norm)) return new THREE.Vector3(v[0], v[1], v[2]);
    }

    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const u = ((h >>> 0) % 10000) / 10000;
    const v2 = (((h >>> 16) % 10000) / 10000);
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v2 - 1);
    const sinP = Math.sin(phi);
    return new THREE.Vector3(
      0.88 * sinP * Math.cos(theta),
      0.88 * Math.cos(phi) * 0.85,
      0.88 * sinP * Math.sin(theta),
    );
  }

  _activationToColor(value, highlighted) {
    const boost = highlighted ? 0.3 : 0;
    const v = Math.min(1, value + boost);

    const low = new THREE.Color(0x8b0000);
    const mid = new THREE.Color(0xff4500);
    const high = new THREE.Color(0xffdd00);
    const peak = new THREE.Color(0xffffff);

    if (v < 0.33) return low.lerp(mid, v / 0.33);
    if (v < 0.66) return mid.clone().lerp(high, (v - 0.33) / 0.33);
    return high.clone().lerp(peak, (v - 0.66) / 0.34);
  }

  _getRegionCenters() {
    return {
      'Visual Cortex':              new THREE.Vector3(0.0,  0.1,  0.9),
      'V1':                         new THREE.Vector3(0.0,  0.1,  0.9),
      'Amygdala':                   new THREE.Vector3(0.6, -0.5, -0.2),
      "Broca's Area":               new THREE.Vector3(-0.8, 0.2, -0.5),
      'Prefrontal Cortex':          new THREE.Vector3(0.0,  0.4, -0.9),
      'Dorsolateral PFC':           new THREE.Vector3(-0.5, 0.6, -0.7),
      'Ventromedial PFC':           new THREE.Vector3(0.0,  -0.2, -0.9),
      'Anterior Cingulate Cortex':  new THREE.Vector3(0.0,  0.3, -0.3),
      'Insula':                     new THREE.Vector3(0.7,  0.0, -0.1),
      'Temporal Pole':              new THREE.Vector3(0.8, -0.3, -0.6),
      "Wernicke's Area":            new THREE.Vector3(-0.7, 0.0,  0.3),
      'Fusiform Gyrus':             new THREE.Vector3(0.5, -0.7,  0.4),
      'Precuneus':                  new THREE.Vector3(0.0,  0.6,  0.5),
      'Orbitofrontal Cortex':       new THREE.Vector3(0.3, -0.3, -0.8),
      'Superior Temporal Sulcus':   new THREE.Vector3(0.8,  0.0,  0.2),
      'Motor Cortex':               new THREE.Vector3(0.0,  0.8, -0.1),
      'Somatosensory Cortex':       new THREE.Vector3(0.0,  0.7,  0.1),
      'Hippocampus':                new THREE.Vector3(0.5, -0.4,  0.1),
      'Nucleus Accumbens':          new THREE.Vector3(0.3, -0.2, -0.4),
      'Thalamus':                   new THREE.Vector3(0.0, -0.1,  0.0),
      'Angular Gyrus':              new THREE.Vector3(-0.6, 0.3,  0.6),
    };
  }

  highlightRegion(index) {
    if (this.disposed) return;
    this.highlightedRegion = index;
    this._paintActivations();
  }

  clearHighlight() {
    if (this.disposed) return;
    this.highlightedRegion = null;
    this._paintActivations();
  }

  setShimmerMode(enabled) {
    if (this.disposed) return;
    this.shimmerMode = enabled;
    if (!enabled) {
      this._paintActivations();
    }
  }

  _animate() {
    if (this.disposed) return;

    if (this.brainGroup && !this._isDragging) {
      this.brainGroup.rotation.y += 0.003;
    }

    if (this.shimmerMode && this.brainMesh) {
      const geo = this.brainMesh.geometry;
      const colors = geo.attributes.color;
      const positions = geo.attributes.position;
      const time = Date.now() * 0.001;
      const vertex = new THREE.Vector3();

      for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i);
        const noise = 0.15 + 0.08 * Math.sin(vertex.x * 5 + time * 2)
                            * Math.cos(vertex.y * 4 + time * 1.5)
                            * Math.sin(vertex.z * 6 + time);
        colors.setXYZ(i, noise * 0.6, noise * 0.25, noise * 0.1);
      }
      colors.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
    this._animationId = requestAnimationFrame(this._animate);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this._animationId);
    if (this.renderer && this._onPointerDown) {
      const el = this.renderer.domElement;
      el.removeEventListener('pointerdown', this._onPointerDown);
      el.removeEventListener('pointermove', this._onPointerMove);
      el.removeEventListener('pointerup', this._onPointerUp);
      el.removeEventListener('pointercancel', this._onPointerUp);
      el.removeEventListener('lostpointercapture', this._onPointerUp);
      el.removeEventListener('wheel', this._onWheel, this._wheelOpts);
    }
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }
    if (this.brainMesh) {
      this.brainMesh.geometry.dispose();
      this.brainMesh.material.dispose();
    }
    if (this.wireframe) {
      this.wireframe.geometry.dispose();
      this.wireframe.material.dispose();
    }
  }
}

if (typeof window !== 'undefined') {
  window.MindmapBrainWidget = MindmapBrainWidget;
}
