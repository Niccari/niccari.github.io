// <define:NEON_CONFIG>
var define_NEON_CONFIG_default = { shop: { category: "\u30D8\u30EB\u30B9\u30BB\u30F3\u30BF\u30FC", name: "\u67B6\u7A7A\u30EC\u30B8\u30E3\u30FC\u30E9\u30F3\u30C9" }, chevron: { count: 48, width: 240, height: 12, gap: 10 }, bulb: { count: 12 } };

// src/renderer/gpu-context.ts
async function initGpu(canvas) {
  if (!navigator.gpu) {
    throw new Error("WebGPU is not supported in this browser.");
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    throw new Error("Failed to get GPU adapter.");
  }
  const device = await adapter.requestDevice();
  device.lost.then((info) => {
    console.error("GPU device lost:", info.message);
  });
  const context = canvas.getContext("webgpu");
  if (!context) {
    throw new Error("Failed to get WebGPU canvas context.");
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });
  return { device, context, format };
}
function resizeCanvas(canvas, device) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.floor(canvas.clientWidth * dpr);
  const height = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

// src/renderer/scene.ts
function towerCenterX(config) {
  const { width, gap } = config.chevron;
  const towerSeparation = width * 2 + gap * 4;
  return { left: -towerSeparation / 2, right: towerSeparation / 2 };
}
function signHeight(config) {
  const { count, height, gap } = config.chevron;
  return count * height + (count - 1) * gap;
}
function buildChevronInstances(config) {
  const { count, width, height, gap } = config.chevron;
  const { left: leftCenterX, right: rightCenterX } = towerCenterX(config);
  const totalTowerHeight = count * height + (count - 1) * gap;
  const topY = totalTowerHeight / 2;
  const instances = [];
  for (let i = 0; i < count; i++) {
    const y = topY - i * (height + gap) - height / 2;
    const groupIndex = Math.floor(i / 4) % 6;
    instances.push({ offsetX: leftCenterX, offsetY: y, groupIndex, towerSide: 0 });
    instances.push({ offsetX: rightCenterX, offsetY: y, groupIndex, towerSide: 1 });
  }
  const data = new Float32Array(instances.length * 4);
  instances.forEach((inst, i) => {
    data[i * 4 + 0] = inst.offsetX;
    data[i * 4 + 1] = inst.offsetY;
    data[i * 4 + 2] = inst.groupIndex;
    data[i * 4 + 3] = inst.towerSide;
  });
  return data;
}
function buildBulbInstances(config) {
  const { count } = config.bulb;
  const { left: leftCX, right: rightCX } = towerCenterX(config);
  const signH = signHeight(config);
  const topY = signH / 2 + 160;
  const cRadius = 90;
  const leftCX2 = leftCX;
  const rightCX2 = rightCX;
  const cy = topY;
  const data = [];
  function addBulbs(centerX, centerY, side) {
    const startAngle = side === "left" ? Math.PI * 3 / 4 : -Math.PI * 3 / 4;
    const sweepAngle = Math.PI * 3 / 2;
    for (let i = 0; i < count; i++) {
      const angle = startAngle + sweepAngle / (count - 1) * i;
      const x = centerX + Math.cos(angle) * cRadius;
      const y = centerY + Math.sin(angle) * cRadius;
      const delay = -(i * 0.12);
      data.push(x, y, 0, delay);
    }
  }
  addBulbs(leftCX2, cy, "left");
  addBulbs(rightCX2, cy, "right");
  return new Float32Array(data);
}
function buildCShapeInstances(config) {
  const { left: leftCX, right: rightCX } = towerCenterX(config);
  const signH = signHeight(config);
  const cy = signH / 2 + 160;
  const ARC_SEGMENTS = 32;
  const data = [];
  function addArc(centerX, side) {
    const startAngle = side === "left" ? Math.PI * 3 / 4 : -Math.PI * 3 / 4;
    const sweepAngle = Math.PI * 3 / 2;
    for (let i = 0; i < ARC_SEGMENTS; i++) {
      const angle = startAngle + sweepAngle / ARC_SEGMENTS * (i + 0.5);
      data.push(centerX, cy, angle, side === "left" ? 0 : 1);
    }
  }
  addArc(leftCX, "left");
  addArc(rightCX, "right");
  return new Float32Array(data);
}
function createStorageBuffer(device, data) {
  const buffer = device.createBuffer({
    size: Math.max(data.byteLength, 16),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
  });
  new Float32Array(buffer.getMappedRange()).set(data);
  buffer.unmap();
  return buffer;
}
function createChevronInstanceBuffer(device, data) {
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
  });
  new Float32Array(buffer.getMappedRange()).set(data);
  buffer.unmap();
  return buffer;
}

// src/shaders/chevron.wgsl
var chevron_default = "struct SceneUniforms {\n    view_proj: mat4x4<f32>,\n    camera_pos: vec3<f32>,\n    time: f32,\n    resolution: vec2<f32>,\n    bloom_threshold: f32,\n    bloom_intensity: f32,\n};\n\nstruct ChevronInstance {\n    offset: vec2<f32>,\n    group_index: f32,\n    tower_side: f32,\n};\n\nstruct VertexOutput {\n    @builtin(position) position: vec4<f32>,\n    @location(0) local_uv: vec2<f32>,\n    @location(1) group_index: f32,\n    @location(2) chevron_index: f32,\n};\n\n@group(0) @binding(0) var<uniform> scene: SceneUniforms;\n@group(1) @binding(0) var<storage, read> instances: array<ChevronInstance>;\n\n// Chevron shape: clip-path polygon(0% 0%, 100% 0%, 85% 50%, 100% 100%, 0% 100%, 15% 50%)\n// Decomposed into 4 triangles via index buffer\nconst VERTS = array<vec2<f32>, 6>(\n    vec2<f32>(0.0,  0.0),\n    vec2<f32>(1.0,  0.0),\n    vec2<f32>(0.85, 0.5),\n    vec2<f32>(1.0,  1.0),\n    vec2<f32>(0.0,  1.0),\n    vec2<f32>(0.15, 0.5),\n);\n\nconst INDICES = array<u32, 12>(\n    0u, 1u, 5u,\n    1u, 2u, 5u,\n    2u, 4u, 5u,\n    2u, 3u, 4u,\n);\n\n@vertex\nfn vs_main(\n    @builtin(vertex_index) vertex_index: u32,\n    @builtin(instance_index) instance_index: u32,\n) -> VertexOutput {\n    let inst = instances[instance_index];\n    let local = VERTS[INDICES[vertex_index]];\n\n    // Config-injected constants (replaced at build time via esbuild define)\n    let chevron_width: f32 = CHEVRON_WIDTH;\n    let chevron_height: f32 = CHEVRON_HEIGHT;\n\n    let scaled = vec2<f32>(\n        (local.x - 0.5) * chevron_width,\n        (local.y - 0.5) * chevron_height,\n    );\n    let world_pos = vec3<f32>(scaled + inst.offset, 0.0);\n\n    var out: VertexOutput;\n    out.position = scene.view_proj * vec4<f32>(world_pos, 1.0);\n    out.local_uv = local;\n    out.group_index = inst.group_index;\n    out.chevron_index = f32(instance_index);\n    return out;\n}\n\n// Rainbow color table (6 groups)\nfn get_rainbow_color(group_idx: f32) -> vec3<f32> {\n    let i = u32(group_idx) % 6u;\n    if (i == 0u) { return vec3<f32>(1.0,  0.0,  0.0); }  // Red\n    if (i == 1u) { return vec3<f32>(1.0,  1.0,  0.0); }  // Yellow\n    if (i == 2u) { return vec3<f32>(0.0,  1.0,  0.0); }  // Green\n    if (i == 3u) { return vec3<f32>(0.0,  1.0,  1.0); }  // Cyan\n    if (i == 4u) { return vec3<f32>(0.0,  0.53, 1.0); }  // Blue\n    return vec3<f32>(0.53, 0.0,  1.0);                    // Purple\n}\n\n// Edge glow: brighter near the silhouette edges\nfn edge_glow(uv: vec2<f32>) -> f32 {\n    let dx = min(uv.x, 1.0 - uv.x);\n    let dy = min(uv.y, 1.0 - uv.y);\n    let d = min(dx, dy) * 8.0; // scale to [0, ~0.5 range]\n    return smoothstep(0.25, 0.0, d);\n}\n\n// Hash-based pseudo-random noise for flicker\nfn hash(n: f32) -> f32 {\n    return fract(sin(n) * 43758.5453123);\n}\n\nfn flicker(chevron_idx: f32, t: f32) -> f32 {\n    // Subtle flicker: most of the time fully on, occasional brief dips\n    let slow = hash(chevron_idx * 0.1 + floor(t * 2.0)) * 0.15;\n    let fast = hash(chevron_idx * 0.3 + floor(t * 17.0)) * 0.06;\n    return 1.0 - slow - fast;\n}\n\n@fragment\nfn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {\n    let t = scene.time;\n    let cycle = 18.0;\n    let delay = in.chevron_index * 0.1;\n    let phase_t = ((t - delay) % cycle + cycle) % cycle;\n\n    var color: vec3<f32>;\n\n    if (phase_t < 6.0) {\n        // Phase 1: red wave\n        let wave = sin(phase_t * 3.14159 / 6.0);\n        color = vec3<f32>(1.0, 0.0, 0.0) * (0.4 + 0.6 * wave);\n    } else if (phase_t < 12.0) {\n        // Phase 2: blue wave\n        let wave = sin((phase_t - 6.0) * 3.14159 / 6.0);\n        color = vec3<f32>(0.0, 0.53, 1.0) * (0.4 + 0.6 * wave);\n    } else {\n        // Phase 3: rainbow per group\n        let wave = sin((phase_t - 12.0) * 3.14159 / 6.0);\n        color = get_rainbow_color(in.group_index) * (0.4 + 0.6 * wave);\n    }\n\n    // Neon flicker\n    let flick = flicker(in.chevron_index, t);\n\n    // HDR glow intensity (exceeds 1.0 \u2192 bloom picks it up)\n    let glow = (4.0 + edge_glow(in.local_uv) * 2.0) * flick;\n    color = color * glow;\n\n    return vec4<f32>(color, 1.0);\n}\n";

// src/shaders/bulb.wgsl
var bulb_default = "struct SceneUniforms {\n    view_proj: mat4x4<f32>,\n    camera_pos: vec3<f32>,\n    time: f32,\n    resolution: vec2<f32>,\n    bloom_threshold: f32,\n    bloom_intensity: f32,\n};\n\nstruct BulbInstance {\n    position: vec3<f32>,\n    delay: f32,\n};\n\nstruct VertexOutput {\n    @builtin(position) position: vec4<f32>,\n    @location(0) local_uv: vec2<f32>,\n    @location(1) delay: f32,\n};\n\n@group(0) @binding(0) var<uniform> scene: SceneUniforms;\n@group(1) @binding(0) var<storage, read> instances: array<BulbInstance>;\n\nconst BULB_RADIUS: f32 = 8.0;\n\n// Billboard quad vertices\nconst QUAD = array<vec2<f32>, 6>(\n    vec2<f32>(-1.0, -1.0),\n    vec2<f32>( 1.0, -1.0),\n    vec2<f32>(-1.0,  1.0),\n    vec2<f32>( 1.0, -1.0),\n    vec2<f32>( 1.0,  1.0),\n    vec2<f32>(-1.0,  1.0),\n);\n\n@vertex\nfn vs_main(\n    @builtin(vertex_index) vi: u32,\n    @builtin(instance_index) ii: u32,\n) -> VertexOutput {\n    let inst = instances[ii];\n    let local = QUAD[vi];\n    // Billboard: offset in view space\n    let world_pos = inst.position + vec3<f32>(local * BULB_RADIUS, 0.0);\n\n    var out: VertexOutput;\n    out.position = scene.view_proj * vec4<f32>(world_pos, 1.0);\n    out.local_uv = local;\n    out.delay = inst.delay;\n    return out;\n}\n\n@fragment\nfn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {\n    // Circular SDF\n    let d = length(in.local_uv);\n    if (d > 1.0) { discard; }\n\n    // Blink: on/off with delay\n    let t = scene.time + in.delay;\n    let blink = step(0.5, fract(t * 1.0));  // 1 Hz blink\n    let brightness = mix(0.2, 6.0, blink);\n\n    // Soft edge glow\n    let glow = (1.0 - smoothstep(0.5, 1.0, d)) * brightness;\n    let color = vec3<f32>(1.0, 0.0, 0.25) * glow;  // red-pink\n\n    return vec4<f32>(color, 1.0);\n}\n";

// src/shaders/c-shape.wgsl
var c_shape_default = "struct SceneUniforms {\n    view_proj: mat4x4<f32>,\n    camera_pos: vec3<f32>,\n    time: f32,\n    resolution: vec2<f32>,\n    bloom_threshold: f32,\n    bloom_intensity: f32,\n};\n\n@group(0) @binding(0) var<uniform> scene: SceneUniforms;\n\n// C-shape is rendered as a series of thin quads arranged in a arc\n// Each instance = one arc quad segment\nstruct ArcInstance {\n    center: vec2<f32>,  // center of the C-shape circle\n    angle: f32,         // midpoint angle of this segment (radians)\n    side: f32,          // 0=left(open right), 1=right(open left)\n};\n\nstruct VertexOutput {\n    @builtin(position) position: vec4<f32>,\n    @location(0) t: f32,  // for flicker animation\n};\n\n@group(1) @binding(0) var<storage, read> instances: array<ArcInstance>;\n\nconst RADIUS: f32 = 90.0;\nconst THICKNESS: f32 = 8.0;\nconst SEG_HALF_ANG: f32 = 0.12;  // half angular width of one quad\n\n@vertex\nfn vs_main(\n    @builtin(vertex_index) vi: u32,\n    @builtin(instance_index) ii: u32,\n) -> VertexOutput {\n    let inst = instances[ii];\n    let angle = inst.angle;\n\n    // Quad corners: inner/outer radius \xD7 two angular edges\n    let angles = array<f32, 4>(\n        angle - SEG_HALF_ANG, angle - SEG_HALF_ANG,\n        angle + SEG_HALF_ANG, angle + SEG_HALF_ANG,\n    );\n    let radii = array<f32, 4>(\n        RADIUS - THICKNESS * 0.5, RADIUS + THICKNESS * 0.5,\n        RADIUS - THICKNESS * 0.5, RADIUS + THICKNESS * 0.5,\n    );\n    let tri_idx = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u);\n    let idx = tri_idx[vi];\n\n    let r = radii[idx];\n    let a = angles[idx];\n    let local = vec2<f32>(cos(a) * r, sin(a) * r);\n    let world_pos = vec3<f32>(inst.center + local, 0.0);\n\n    var out: VertexOutput;\n    out.position = scene.view_proj * vec4<f32>(world_pos, 1.0);\n    out.t = scene.time;\n    return out;\n}\n\n@fragment\nfn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {\n    // Neon flicker\n    let flicker = 0.85 + 0.15 * sin(in.t * 17.3);\n    let color = vec3<f32>(1.0, 0.0, 0.25) * 5.0 * flicker;\n    return vec4<f32>(color, 1.0);\n}\n";

// src/shaders/text.wgsl
var text_default = "struct SceneUniforms {\n    view_proj: mat4x4<f32>,\n    camera_pos: vec3<f32>,\n    time: f32,\n    resolution: vec2<f32>,\n    bloom_threshold: f32,\n    bloom_intensity: f32,\n};\n\nstruct TextInstance {\n    position: vec2<f32>,\n    size: vec2<f32>,\n    uv_offset: vec2<f32>,\n    uv_size: vec2<f32>,\n    color: vec4<f32>,\n    delay: f32,\n    _pad0: f32,\n    _pad1: f32,\n    _pad2: f32,\n};\n\nstruct VertexOutput {\n    @builtin(position) position: vec4<f32>,\n    @location(0) tex_uv: vec2<f32>,\n    @location(1) color: vec4<f32>,\n    @location(2) delay: f32,\n};\n\n@group(0) @binding(0) var<uniform> scene: SceneUniforms;\n@group(1) @binding(0) var<storage, read> instances: array<TextInstance>;\n@group(1) @binding(1) var atlas_texture: texture_2d<f32>;\n@group(1) @binding(2) var atlas_sampler: sampler;\n\nconst QUAD = array<vec2<f32>, 6>(\n    vec2<f32>(0.0, 0.0),\n    vec2<f32>(1.0, 0.0),\n    vec2<f32>(0.0, 1.0),\n    vec2<f32>(1.0, 0.0),\n    vec2<f32>(1.0, 1.0),\n    vec2<f32>(0.0, 1.0),\n);\n\n@vertex\nfn vs_main(\n    @builtin(vertex_index) vi: u32,\n    @builtin(instance_index) ii: u32,\n) -> VertexOutput {\n    let inst = instances[ii];\n    let local = QUAD[vi];\n    let world_2d = inst.position + local * inst.size;\n    let world_pos = vec3<f32>(world_2d, 0.0);\n\n    var out: VertexOutput;\n    out.position = scene.view_proj * vec4<f32>(world_pos, 1.0);\n    // Flip V: canvas-2D atlas has Y=0 at top; world space has Y=0 at bottom.\n    out.tex_uv = inst.uv_offset + vec2<f32>(local.x, 1.0 - local.y) * inst.uv_size;\n    out.color = inst.color;\n    out.delay = inst.delay;\n    return out;\n}\n\n@fragment\nfn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {\n    let alpha = textureSample(atlas_texture, atlas_sampler, in.tex_uv).a;\n    if (alpha < 0.05) { discard; }\n\n    // Neon pulse\n    let t = scene.time + in.delay;\n    let pulse = 0.7 + 0.3 * sin(t * 3.14159 * 2.0 / 1.5);\n\n    let color = in.color.rgb * pulse * 5.0;  // HDR glow\n    return vec4<f32>(color, alpha);\n}\n";

// src/renderer/pipeline-manager.ts
function createChevronPipeline(device, targetFormat, chevronWidth, chevronHeight) {
  const wgsl = chevron_default.replace("CHEVRON_WIDTH", `${chevronWidth.toFixed(1)}`).replace("CHEVRON_HEIGHT", `${chevronHeight.toFixed(1)}`);
  const shaderModule = device.createShaderModule({ code: wgsl });
  const sceneBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" }
      }
    ]
  });
  const instanceBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" }
      }
    ]
  });
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [sceneBindGroupLayout, instanceBindGroupLayout]
  });
  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main"
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format: targetFormat }]
    },
    primitive: { topology: "triangle-list" }
  });
  return { pipeline, sceneBindGroupLayout, instanceBindGroupLayout };
}
function createInstancedPipeline(device, wgsl, targetFormat, vertexVisibility = GPUShaderStage.VERTEX) {
  const module = device.createShaderModule({ code: wgsl });
  const sceneLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" }
      }
    ]
  });
  const instanceLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: vertexVisibility,
        buffer: { type: "read-only-storage" }
      }
    ]
  });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [sceneLayout, instanceLayout] }),
    vertex: { module, entryPoint: "vs_main" },
    fragment: { module, entryPoint: "fs_main", targets: [{ format: targetFormat }] },
    primitive: { topology: "triangle-list" }
  });
  return { pipeline, sceneBindGroupLayout: sceneLayout, instanceBindGroupLayout: instanceLayout };
}
function createBulbPipeline(device, targetFormat) {
  return createInstancedPipeline(device, bulb_default, targetFormat);
}
function createCShapePipeline(device, targetFormat) {
  return createInstancedPipeline(device, c_shape_default, targetFormat);
}
function createTextPipeline(device, targetFormat) {
  const module = device.createShaderModule({ code: text_default });
  const sceneLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }
    ]
  });
  const instanceLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} }
    ]
  });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [sceneLayout, instanceLayout] }),
    vertex: { module, entryPoint: "vs_main" },
    fragment: {
      module,
      entryPoint: "fs_main",
      targets: [{
        format: targetFormat,
        blend: {
          color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "zero", operation: "add" }
        }
      }]
    },
    primitive: { topology: "triangle-list" }
  });
  return { pipeline, sceneBindGroupLayout: sceneLayout, instanceBindGroupLayout: instanceLayout };
}

// src/renderer/math.ts
function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[i + k * 4] * b[k + j * 4];
      }
      out[i + j * 4] = sum;
    }
  }
  return out;
}
function mat4Perspective(fovYRad, aspect, near, far) {
  const m = new Float32Array(16);
  const f = 1 / Math.tan(fovYRad / 2);
  const rangeInv = 1 / (near - far);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (near + far) * rangeInv;
  m[11] = -1;
  m[14] = near * far * rangeInv * 2;
  return m;
}
function mat4LookAt(eye, target, up) {
  const zx = eye[0] - target[0];
  const zy = eye[1] - target[1];
  const zz = eye[2] - target[2];
  const zLen = Math.sqrt(zx * zx + zy * zy + zz * zz);
  const z = [zx / zLen, zy / zLen, zz / zLen];
  const xx = up[1] * z[2] - up[2] * z[1];
  const xy = up[2] * z[0] - up[0] * z[2];
  const xz = up[0] * z[1] - up[1] * z[0];
  const xLen = Math.sqrt(xx * xx + xy * xy + xz * xz);
  const x = [xx / xLen, xy / xLen, xz / xLen];
  const y = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0]
  ];
  const m = new Float32Array(16);
  m[0] = x[0];
  m[4] = x[1];
  m[8] = x[2];
  m[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  m[1] = y[0];
  m[5] = y[1];
  m[9] = y[2];
  m[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  m[2] = z[0];
  m[6] = z[1];
  m[10] = z[2];
  m[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  m[15] = 1;
  return m;
}

// src/renderer/camera.ts
function createCamera(signHeight2) {
  return {
    azimuth: 0,
    elevation: 0,
    distance: 1200,
    target: [0, 0, 0]
  };
}
function getCameraPosition(cam) {
  const { azimuth, elevation, distance, target } = cam;
  return [
    target[0] + distance * Math.cos(elevation) * Math.sin(azimuth),
    target[1] + distance * Math.sin(elevation),
    target[2] + distance * Math.cos(elevation) * Math.cos(azimuth)
  ];
}
function getViewProjMatrix(cam, width, height) {
  const aspect = width / height;
  const proj = mat4Perspective(60 * Math.PI / 180, aspect, 1, 8e3);
  const eye = getCameraPosition(cam);
  const view = mat4LookAt(eye, cam.target, [0, 1, 0]);
  return mat4Multiply(proj, view);
}
function attachOrbitControls(canvas, cam) {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  function onMouseDown(e) {
    if (e.button === 0) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    }
  }
  function onMouseMove(e) {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    cam.azimuth += dx * 5e-3;
    cam.elevation = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, cam.elevation - dy * 5e-3));
  }
  function onMouseUp() {
    dragging = false;
  }
  function onWheel(e) {
    e.preventDefault();
    cam.distance = Math.max(200, Math.min(4e3, cam.distance + e.deltaY * 0.8));
  }
  function onDblClick() {
    cam.azimuth = 0;
    cam.elevation = 0;
    cam.distance = 1200;
  }
  let lastTouchDist = 0;
  let lastTouchX = 0;
  let lastTouchY = 0;
  let touchDragging = false;
  function onTouchStart(e) {
    if (e.touches.length === 1) {
      touchDragging = true;
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      touchDragging = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist = Math.sqrt(dx * dx + dy * dy);
    }
  }
  function onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1 && touchDragging) {
      const dx = e.touches[0].clientX - lastTouchX;
      const dy = e.touches[0].clientY - lastTouchY;
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      cam.azimuth += dx * 5e-3;
      cam.elevation = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, cam.elevation - dy * 5e-3));
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const delta = lastTouchDist - dist;
      cam.distance = Math.max(200, Math.min(4e3, cam.distance + delta * 2));
      lastTouchDist = dist;
    }
  }
  function onTouchEnd() {
    touchDragging = false;
  }
  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", onDblClick);
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  canvas.addEventListener("touchmove", onTouchMove, { passive: false });
  canvas.addEventListener("touchend", onTouchEnd);
  return () => {
    canvas.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("dblclick", onDblClick);
    canvas.removeEventListener("touchstart", onTouchStart);
    canvas.removeEventListener("touchmove", onTouchMove);
    canvas.removeEventListener("touchend", onTouchEnd);
  };
}

// src/shaders/fullscreen-quad.wgsl
var fullscreen_quad_default = "// Generates a full-screen triangle covering [-1,1]x[-1,1]\n// vertex_index: 0,1,2 \u2192 covers the entire screen\nstruct VertexOutput {\n    @builtin(position) position: vec4<f32>,\n    @location(0) uv: vec2<f32>,\n};\n\n@vertex\nfn vs_main(@builtin(vertex_index) vi: u32) -> VertexOutput {\n    var pos = array<vec2<f32>, 3>(\n        vec2<f32>(-1.0, -1.0),\n        vec2<f32>( 3.0, -1.0),\n        vec2<f32>(-1.0,  3.0),\n    );\n    var uv = array<vec2<f32>, 3>(\n        vec2<f32>(0.0, 1.0),\n        vec2<f32>(2.0, 1.0),\n        vec2<f32>(0.0, -1.0),\n    );\n    var out: VertexOutput;\n    out.position = vec4<f32>(pos[vi], 0.0, 1.0);\n    out.uv = uv[vi];\n    return out;\n}\n";

// src/shaders/bloom-threshold.wgsl
var bloom_threshold_default = "// Extracts bright regions above a threshold for bloom\nstruct BloomParams {\n    threshold: f32,\n    knee: f32,\n    _pad0: f32,\n    _pad1: f32,\n};\n\n@group(0) @binding(0) var src_texture: texture_2d<f32>;\n@group(0) @binding(1) var src_sampler: sampler;\n@group(0) @binding(2) var<uniform> params: BloomParams;\n\n@fragment\nfn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {\n    let color = textureSample(src_texture, src_sampler, uv);\n    let lum = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));\n\n    // Soft knee threshold\n    let rq = clamp(lum - params.threshold + params.knee, 0.0, 2.0 * params.knee);\n    let weight = (rq * rq) / (4.0 * params.knee + 0.00001);\n    let contribution = max(weight, lum - params.threshold) / max(lum, 0.00001);\n\n    return vec4<f32>(color.rgb * contribution, 1.0);\n}\n";

// src/shaders/bloom-blur.wgsl
var bloom_blur_default = "// Dual-pass Gaussian blur (horizontal + vertical)\n// Used for both downsample and upsample stages\nstruct BlurParams {\n    texel_size: vec2<f32>,\n    direction: vec2<f32>,  // (1,0) horizontal, (0,1) vertical\n};\n\n@group(0) @binding(0) var src_texture: texture_2d<f32>;\n@group(0) @binding(1) var src_sampler: sampler;\n@group(0) @binding(2) var<uniform> params: BlurParams;\n\n// 9-tap Gaussian weights (\u03C3\u22481.5)\nconst W0: f32 = 0.2270270270;\nconst W1: f32 = 0.3162162162;\nconst W2: f32 = 0.0702702703;\nconst W3: f32 = 0.0161621622;\nconst W4: f32 = 0.0030303030;\n\n@fragment\nfn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {\n    let d = params.texel_size * params.direction;\n\n    var result = textureSample(src_texture, src_sampler, uv) * W0;\n    result += textureSample(src_texture, src_sampler, uv + d * 1.3846153846) * W1;\n    result += textureSample(src_texture, src_sampler, uv - d * 1.3846153846) * W1;\n    result += textureSample(src_texture, src_sampler, uv + d * 3.2307692308) * W2;\n    result += textureSample(src_texture, src_sampler, uv - d * 3.2307692308) * W2;\n    result += textureSample(src_texture, src_sampler, uv + d * 5.0) * W3;\n    result += textureSample(src_texture, src_sampler, uv - d * 5.0) * W3;\n    result += textureSample(src_texture, src_sampler, uv + d * 7.0) * W4;\n    result += textureSample(src_texture, src_sampler, uv - d * 7.0) * W4;\n\n    return result;\n}\n";

// src/shaders/composite.wgsl
var composite_default = "// Final composite: scene HDR + bloom \u2192 tone-mapped LDR output\nstruct CompositeParams {\n    bloom_intensity: f32,\n    _pad0: f32,\n    _pad1: f32,\n    _pad2: f32,\n};\n\n@group(0) @binding(0) var scene_texture: texture_2d<f32>;\n@group(0) @binding(1) var bloom_texture: texture_2d<f32>;\n@group(0) @binding(2) var tex_sampler: sampler;\n@group(0) @binding(3) var<uniform> params: CompositeParams;\n\n// ACES filmic tone mapping\nfn aces_tonemap(x: vec3<f32>) -> vec3<f32> {\n    let a = 2.51;\n    let b = 0.03;\n    let c = 2.43;\n    let d = 0.59;\n    let e = 0.14;\n    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));\n}\n\n@fragment\nfn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {\n    let scene = textureSample(scene_texture, tex_sampler, uv);\n    let bloom = textureSample(bloom_texture, tex_sampler, uv);\n\n    var color = scene.rgb + bloom.rgb * params.bloom_intensity;\n    color = aces_tonemap(color);\n    // Gamma correction (sRGB)\n    color = pow(color, vec3<f32>(1.0 / 2.2));\n\n    return vec4<f32>(color, 1.0);\n}\n";

// src/renderer/bloom.ts
var BLOOM_LEVELS = 5;
function createBloomRenderer(device, outputFormat) {
  const linearSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge"
  });
  const quadModule = device.createShaderModule({ code: fullscreen_quad_default });
  const thresholdModule = device.createShaderModule({
    code: fullscreen_quad_default + "\n" + bloom_threshold_default
  });
  const blurModule = device.createShaderModule({
    code: fullscreen_quad_default + "\n" + bloom_blur_default
  });
  const compositeModule = device.createShaderModule({
    code: fullscreen_quad_default + "\n" + composite_default
  });
  const texSampParamLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }
    ]
  });
  const compositeLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }
    ]
  });
  const hdrFormat = "rgba16float";
  function makeFullscreenPipeline(module, layout, targetFormat, blendAdditive = false) {
    const blend = blendAdditive ? {
      color: { srcFactor: "one", dstFactor: "one", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "zero", operation: "add" }
    } : void 0;
    return device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module: quadModule, entryPoint: "vs_main" },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{ format: targetFormat, blend }]
      },
      primitive: { topology: "triangle-list" }
    });
  }
  const thresholdPipeline = makeFullscreenPipeline(thresholdModule, texSampParamLayout, hdrFormat);
  const blurPipeline = makeFullscreenPipeline(blurModule, texSampParamLayout, hdrFormat);
  const upsamplePipeline = makeFullscreenPipeline(blurModule, texSampParamLayout, hdrFormat, true);
  const compositePipeline = makeFullscreenPipeline(compositeModule, compositeLayout, outputFormat);
  const thresholdParamBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(thresholdParamBuffer, 0, new Float32Array([0.8, 0.2, 0, 0]));
  const blurHParamBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const blurVParamBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const compositeParamBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  let hdrTexture;
  let textures;
  let thresholdBindGroup;
  let blurBindGroups = [];
  let upsampleBindGroups = [];
  let compositeBindGroup;
  function makeHdrTex(w, h) {
    return device.createTexture({
      size: [w, h],
      format: hdrFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
  }
  function createTextures(width, height) {
    hdrTexture?.destroy();
    textures?.bright?.destroy();
    textures?.mips?.forEach((t) => t.destroy());
    textures?.pingTex?.forEach((t) => t.destroy());
    hdrTexture = makeHdrTex(width, height);
    const bright = makeHdrTex(width, height);
    const mips = [];
    const pingTex = [];
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      const w = Math.max(1, width >> i + 1);
      const h = Math.max(1, height >> i + 1);
      mips.push(makeHdrTex(w, h));
      pingTex.push(makeHdrTex(w, h));
    }
    textures = { bright, mips, pingTex, sampler: linearSampler };
    thresholdBindGroup = device.createBindGroup({
      layout: texSampParamLayout,
      entries: [
        { binding: 0, resource: hdrTexture.createView() },
        { binding: 1, resource: linearSampler },
        { binding: 2, resource: { buffer: thresholdParamBuffer } }
      ]
    });
    blurBindGroups = mips.map((_mipTex, i) => {
      const srcTex = i === 0 ? bright : mips[i - 1];
      const ping = pingTex[i];
      const mipW = Math.max(1, width >> i + 1);
      const mipH = Math.max(1, height >> i + 1);
      const hBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const vBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(hBuf, 0, new Float32Array([1 / mipW, 1 / mipH, 1, 0]));
      device.queue.writeBuffer(vBuf, 0, new Float32Array([1 / mipW, 1 / mipH, 0, 1]));
      const h = device.createBindGroup({
        layout: texSampParamLayout,
        entries: [
          { binding: 0, resource: srcTex.createView() },
          { binding: 1, resource: linearSampler },
          { binding: 2, resource: { buffer: hBuf } }
        ]
      });
      const v = device.createBindGroup({
        layout: texSampParamLayout,
        entries: [
          { binding: 0, resource: ping.createView() },
          { binding: 1, resource: linearSampler },
          { binding: 2, resource: { buffer: vBuf } }
        ]
      });
      return { h, v };
    });
    upsampleBindGroups = [];
    for (let i = BLOOM_LEVELS - 1; i > 0; i--) {
      const srcMip = mips[i];
      const mipW = Math.max(1, width >> i);
      const mipH = Math.max(1, height >> i);
      const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buf, 0, new Float32Array([1 / mipW, 1 / mipH, 1, 0]));
      upsampleBindGroups.push(device.createBindGroup({
        layout: texSampParamLayout,
        entries: [
          { binding: 0, resource: srcMip.createView() },
          { binding: 1, resource: linearSampler },
          { binding: 2, resource: { buffer: buf } }
        ]
      }));
    }
  }
  function rebuildCompositeBindGroup(bloomIntensity) {
    device.queue.writeBuffer(compositeParamBuffer, 0, new Float32Array([bloomIntensity, 0, 0, 0]));
    compositeBindGroup = device.createBindGroup({
      layout: compositeLayout,
      entries: [
        { binding: 0, resource: hdrTexture.createView() },
        { binding: 1, resource: textures.mips[0].createView() },
        { binding: 2, resource: linearSampler },
        { binding: 3, resource: { buffer: compositeParamBuffer } }
      ]
    });
  }
  function renderPass(encoder, bindGroup, pipelineObj, targetView, loadOp = "clear") {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: targetView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp, storeOp: "store" }]
    });
    pass.setPipeline(pipelineObj);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }
  let currentWidth = 0;
  let currentHeight = 0;
  let currentIntensity = 1.5;
  createTextures(1, 1);
  rebuildCompositeBindGroup(currentIntensity);
  return {
    get hdrTexture() {
      return hdrTexture;
    },
    get hdrView() {
      return hdrTexture.createView();
    },
    resize(width, height) {
      if (width === currentWidth && height === currentHeight) return;
      currentWidth = width;
      currentHeight = height;
      createTextures(width, height);
      rebuildCompositeBindGroup(currentIntensity);
    },
    render(encoder, swapChainView, width, height, bloomIntensity) {
      this.resize(width, height);
      if (bloomIntensity !== currentIntensity) {
        currentIntensity = bloomIntensity;
        rebuildCompositeBindGroup(bloomIntensity);
      }
      renderPass(encoder, thresholdBindGroup, thresholdPipeline, textures.bright.createView());
      for (let i = 0; i < blurBindGroups.length; i++) {
        const bg = blurBindGroups[i];
        renderPass(encoder, bg.h, blurPipeline, textures.pingTex[i].createView());
        renderPass(encoder, bg.v, blurPipeline, textures.mips[i].createView());
      }
      for (let j = 0; j < upsampleBindGroups.length; j++) {
        const dstIdx = BLOOM_LEVELS - 2 - j;
        const dstMip = textures.mips[dstIdx];
        renderPass(encoder, upsampleBindGroups[j], upsamplePipeline, dstMip.createView(), "load");
      }
      renderPass(encoder, compositeBindGroup, compositePipeline, swapChainView);
    }
  };
}

// src/renderer/text-atlas.ts
var CELL_SIZE = 128;
var FONT_SIZE = 90;
var COLS = 8;
async function buildTextAtlas(device, chars) {
  const uniqueChars = [...new Set(chars)];
  const rows = Math.ceil(uniqueChars.length / COLS);
  const atlasW = COLS * CELL_SIZE;
  const atlasH = rows * CELL_SIZE;
  const offscreen = new OffscreenCanvas(atlasW, atlasH);
  const ctx = offscreen.getContext("2d");
  ctx.clearRect(0, 0, atlasW, atlasH);
  ctx.font = `bold ${FONT_SIZE}px "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "white";
  const glyphs = /* @__PURE__ */ new Map();
  uniqueChars.forEach((char, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const px = col * CELL_SIZE;
    const py = row * CELL_SIZE;
    ctx.fillText(char, px + CELL_SIZE / 2, py + CELL_SIZE / 2);
    glyphs.set(char, {
      char,
      u: px / atlasW,
      v: py / atlasH,
      uw: CELL_SIZE / atlasW,
      uh: CELL_SIZE / atlasH,
      w: CELL_SIZE,
      h: CELL_SIZE
    });
  });
  const imageBitmap = await createImageBitmap(offscreen);
  const texture = device.createTexture({
    size: [atlasW, atlasH],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
  });
  device.queue.copyExternalImageToTexture(
    { source: imageBitmap },
    { texture },
    [atlasW, atlasH]
  );
  return { texture, glyphs, atlasWidth: atlasW, atlasHeight: atlasH };
}
function buildTextInstances(chars, glyphs, charSize) {
  const FLOATS_PER = 16;
  const data = new Float32Array(chars.length * FLOATS_PER);
  chars.forEach((c, i) => {
    const g = glyphs.get(c.char);
    if (!g) return;
    const base = i * FLOATS_PER;
    data[base + 0] = c.x - charSize / 2;
    data[base + 1] = c.y - charSize / 2;
    data[base + 2] = charSize;
    data[base + 3] = charSize;
    data[base + 4] = g.u;
    data[base + 5] = g.v;
    data[base + 6] = g.uw;
    data[base + 7] = g.uh;
    data[base + 8] = c.color[0];
    data[base + 9] = c.color[1];
    data[base + 10] = c.color[2];
    data[base + 11] = 1;
    data[base + 12] = c.delay;
    data[base + 13] = 0;
    data[base + 14] = 0;
    data[base + 15] = 0;
  });
  return data;
}

// src/renderer/types.ts
var SCENE_UNIFORMS_SIZE = 96;

// src/renderer/main.ts
async function main() {
  const canvas = document.getElementById("neon-canvas");
  if (!canvas) throw new Error("Canvas element not found");
  const config = define_NEON_CONFIG_default;
  const { device, context, format } = await initGpu(canvas);
  resizeCanvas(canvas, device);
  const observer = new ResizeObserver(() => resizeCanvas(canvas, device));
  observer.observe(canvas);
  const camera = createCamera(0);
  attachOrbitControls(canvas, camera);
  const uniformBuffer = device.createBuffer({
    size: SCENE_UNIFORMS_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const HDR = "rgba16float";
  const chevronData = buildChevronInstances(config);
  const chevronBuffer = createChevronInstanceBuffer(device, chevronData);
  const chevronCount = chevronData.length / 4;
  const chevronPipeline = createChevronPipeline(device, HDR, config.chevron.width, config.chevron.height);
  const bulbData = buildBulbInstances(config);
  const bulbBuffer = createStorageBuffer(device, bulbData);
  const bulbCount = bulbData.length / 4;
  const bulbPipeline = createBulbPipeline(device, HDR);
  const cShapeData = buildCShapeInstances(config);
  const cShapeBuffer = createStorageBuffer(device, cShapeData);
  const cShapeCount = cShapeData.length / 4;
  const cShapePipeline = createCShapePipeline(device, HDR);
  const allChars = [...config.shop.name, ...config.shop.category];
  const atlas = await buildTextAtlas(device, allChars);
  const signH = signHeight(config);
  const { left: leftCX } = towerCenterX(config);
  const CHAR_SIZE = 110;
  const ARCH_CHAR_SIZE = 80;
  const nameChars = [...config.shop.name];
  const nameHeight = nameChars.length * CHAR_SIZE;
  const nameStartY = nameHeight / 2 - CHAR_SIZE / 2;
  const nameInstances = nameChars.map((char, i) => ({
    char,
    x: 0,
    y: nameStartY - i * CHAR_SIZE,
    delay: -(i * 0.1),
    color: [0, 0.83, 1]
    // cyan
  }));
  const categoryChars = [...config.shop.category];
  const archY = signH / 2 + 160 + 160;
  const archStartX = -(categoryChars.length - 1) * ARCH_CHAR_SIZE / 2;
  const archInstances = categoryChars.map((char, i) => ({
    char,
    x: archStartX + i * ARCH_CHAR_SIZE,
    y: archY,
    delay: -(i * 0.08),
    color: [1, 0, 0.25]
    // red-pink
  }));
  const textInstanceData = buildTextInstances(
    [...nameInstances, ...archInstances],
    atlas.glyphs,
    CHAR_SIZE
  );
  const textBuffer = createStorageBuffer(device, textInstanceData);
  const textCount = textInstanceData.length / 16;
  const textPipeline = createTextPipeline(device, HDR);
  const atlasSampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
  const bloom = createBloomRenderer(device, format);
  function makeInstanceBG(layout, buf) {
    return device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer: buf } }]
    });
  }
  function makeSceneBG(layout) {
    return device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
    });
  }
  const chevronSceneBG = makeSceneBG(chevronPipeline.sceneBindGroupLayout);
  const chevronInstBG = makeInstanceBG(chevronPipeline.instanceBindGroupLayout, chevronBuffer);
  const bulbSceneBG = makeSceneBG(bulbPipeline.sceneBindGroupLayout);
  const bulbInstBG = makeInstanceBG(bulbPipeline.instanceBindGroupLayout, bulbBuffer);
  const cShapeSceneBG = makeSceneBG(cShapePipeline.sceneBindGroupLayout);
  const cShapeInstBG = makeInstanceBG(cShapePipeline.instanceBindGroupLayout, cShapeBuffer);
  const textSceneBG = makeSceneBG(textPipeline.sceneBindGroupLayout);
  const textInstBG = device.createBindGroup({
    layout: textPipeline.instanceBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: textBuffer } },
      { binding: 1, resource: atlas.texture.createView() },
      { binding: 2, resource: atlasSampler }
    ]
  });
  const startTime = performance.now();
  function frame() {
    const elapsed = (performance.now() - startTime) / 1e3;
    const W = canvas.width;
    const H = canvas.height;
    bloom.resize(W, H);
    const viewProj = getViewProjMatrix(camera, W, H);
    const eye = getCameraPosition(camera);
    const uniformData = new Float32Array(SCENE_UNIFORMS_SIZE / 4);
    uniformData.set(viewProj, 0);
    uniformData[16] = eye[0];
    uniformData[17] = eye[1];
    uniformData[18] = eye[2];
    uniformData[19] = elapsed;
    uniformData[20] = W;
    uniformData[21] = H;
    uniformData[22] = 0.8;
    uniformData[23] = 1.5;
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);
    const encoder = device.createCommandEncoder();
    const geoPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: bloom.hdrView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store"
      }]
    });
    geoPass.setPipeline(chevronPipeline.pipeline);
    geoPass.setBindGroup(0, chevronSceneBG);
    geoPass.setBindGroup(1, chevronInstBG);
    geoPass.draw(12, chevronCount);
    geoPass.setPipeline(cShapePipeline.pipeline);
    geoPass.setBindGroup(0, cShapeSceneBG);
    geoPass.setBindGroup(1, cShapeInstBG);
    geoPass.draw(6, cShapeCount);
    geoPass.setPipeline(bulbPipeline.pipeline);
    geoPass.setBindGroup(0, bulbSceneBG);
    geoPass.setBindGroup(1, bulbInstBG);
    geoPass.draw(6, bulbCount);
    geoPass.setPipeline(textPipeline.pipeline);
    geoPass.setBindGroup(0, textSceneBG);
    geoPass.setBindGroup(1, textInstBG);
    geoPass.draw(6, textCount);
    geoPass.end();
    bloom.render(encoder, context.getCurrentTexture().createView(), W, H, 1.5);
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
main().catch((err) => {
  const msg = document.createElement("div");
  msg.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#ff0040;font-size:1.5rem;font-family:monospace;background:#000;text-align:center;padding:2rem;";
  msg.textContent = `WebGPU Error: ${err instanceof Error ? err.message : String(err)}`;
  document.body.appendChild(msg);
});
