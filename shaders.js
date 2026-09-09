// morphogen — shaders (GLSL ES 1.00, runs on WebGL1 and WebGL2)
const SH = {};

SH.VS = `attribute vec2 p; varying vec2 v;
void main(){ v = p*0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

// State texture holds (A, B). Float when the device allows it,
// otherwise packed as two 16-bit fixed-point values in RGBA8.
SH.COMMON = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_state;
#ifdef PACKED
vec2 readT(sampler2D t, vec2 uv){
  vec4 c = floor(texture2D(t, uv)*255.0 + 0.5);
  return vec2(c.r*256.0 + c.g, c.b*256.0 + c.a)/65535.0;
}
vec4 writeS(vec2 s){
  vec2 q = floor(clamp(s, 0.0, 1.0)*65535.0 + 0.5);
  vec2 hi = floor(q/256.0); vec2 lo = q - hi*256.0;
  return vec4(hi.x, lo.x, hi.y, lo.y)/255.0;
}
#else
vec2 readT(sampler2D t, vec2 uv){ return texture2D(t, uv).rg; }
vec4 writeS(vec2 s){ return vec4(clamp(s, 0.0, 1.0), 0.0, 1.0); }
#endif
vec2 readS(vec2 uv){ return readT(u_state, uv); }
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
`;

// Gray-Scott step, dt = 1, 9-point Laplacian (scaled by 1/4 as is standard).
// u_aniso removes a fraction of the diffusion along direction u_n.
// ATLAS mode: the texture is a grid of independent tiles, each with its own (F, k).
SH.SIM = `
uniform vec2 u_px; uniform float u_dA, u_dB;
#ifdef ATLAS
uniform float u_G, u_T; uniform vec4 u_Fk;
#else
uniform float u_F, u_k; uniform vec2 u_n; uniform float u_aniso; uniform vec4 u_paint;
#endif
varying vec2 v;
#ifdef ATLAS
vec2 S(vec2 d, vec2 tile, vec2 loc){ vec2 l = fract(loc + d/u_T); return readS((tile + l)/u_G); }
#else
vec2 S(vec2 d, vec2 tile, vec2 loc){ return readS(fract(v + d*u_px)); }
#endif
void main(){
  vec2 tile = vec2(0.0), loc = vec2(0.0);
  float F, k; vec2 n = vec2(1.0, 0.0); float an = 0.0;
#ifdef ATLAS
  tile = floor(v*u_G); loc = v*u_G - tile;
  F = mix(u_Fk.x, u_Fk.y, (tile.x + 0.5)/u_G);
  k = mix(u_Fk.z, u_Fk.w, (tile.y + 0.5)/u_G);
#else
  F = u_F; k = u_k; n = u_n; an = u_aniso;
#endif
  vec2 c  = S(vec2( 0.0, 0.0), tile, loc);
  vec2 e  = S(vec2( 1.0, 0.0), tile, loc), w  = S(vec2(-1.0, 0.0), tile, loc);
  vec2 nn = S(vec2( 0.0, 1.0), tile, loc), ss = S(vec2( 0.0,-1.0), tile, loc);
  vec2 ne = S(vec2( 1.0, 1.0), tile, loc), nw = S(vec2(-1.0, 1.0), tile, loc);
  vec2 se = S(vec2( 1.0,-1.0), tile, loc), sw = S(vec2(-1.0,-1.0), tile, loc);
  vec2 lap = 0.2*(e + w + nn + ss) + 0.05*(ne + nw + se + sw) - c;
  if (an > 0.0) {
    vec2 fxx = e + w - 2.0*c, fyy = nn + ss - 2.0*c;
    vec2 fxy = 0.25*(ne - nw - se + sw);
    vec2 fnn = n.x*n.x*fxx + 2.0*n.x*n.y*fxy + n.y*n.y*fyy;
    lap -= an*0.25*fnn;
  }
  float a = c.x, b = c.y;
  float abb = a*b*b;
  a += u_dA*lap.x - abb + F*(1.0 - a);
  b += u_dB*lap.y + abb - (F + k)*b;
#ifndef ATLAS
  if (u_paint.w > 0.0) {
    vec2 d = (v - u_paint.xy)/u_px; float r = length(d)/u_paint.z;
    b += u_paint.w*exp(-r*r*3.0);
  }
#endif
  gl_FragColor = writeS(vec2(a, b));
}`;

SH.SEED = `
uniform vec2 u_px; uniform float u_seed;
#ifdef ATLAS
uniform float u_G, u_T;
#endif
varying vec2 v;
void main(){
  float b = 0.0;
#ifdef ATLAS
  vec2 tile = floor(v*u_G); vec2 loc = v*u_G - tile;
  for (int i = 0; i < 3; i++) {
    vec2 c = vec2(hash(tile*7.1 + float(i)*13.7 + u_seed), hash(tile*3.3 + float(i)*5.9 + u_seed + 17.0));
    c = 0.15 + 0.7*c;
    vec2 d = (loc - c)*u_T;
    b += 0.5*smoothstep(7.0, 3.0, length(d));
  }
#else
  for (int i = 0; i < 7; i++) {
    vec2 c = vec2(hash(vec2(float(i)*13.7 + u_seed, 1.0)), hash(vec2(float(i)*5.9 + u_seed, 2.0)));
    c = 0.1 + 0.8*c;
    vec2 d = (v - c)/u_px;
    b += 0.5*smoothstep(9.0, 4.0, length(d));
  }
#endif
  b += 0.01*hash(v*4096.0 + u_seed);
  gl_FragColor = writeS(vec2(1.0, min(b, 1.0)));
}`;

// Trail texture (RGBA8, linear-filtered): r = recent activity, g = age, b = B*2 (last frame's B, for the next pass)
SH.TRAIL = `
uniform sampler2D u_trail; varying vec2 v;
void main(){
  vec2 s = readS(v); vec4 t = texture2D(u_trail, v);
  float b = s.y; float prev = t.b*0.5;
  float act = min(1.0, abs(b - prev)*30.0);
  act = max(t.r*0.93 - 0.5/255.0, act);
  float age = (b > 0.1) ? min(1.0, t.g + 0.0025) : max(0.0, t.g - 0.006);
  gl_FragColor = vec4(act, age, min(1.0, b*2.0), 1.0);
}`;

// Sweep display: same layout as TRAIL but no history
SH.DISP = `
varying vec2 v;
void main(){ vec2 s = readS(v); gl_FragColor = vec4(0.0, 0.0, min(1.0, s.y*2.0), 1.0); }`;

SH.RENDER = `
uniform sampler2D u_trail; uniform vec2 u_px; uniform vec2 u_light;
uniform float u_time, u_fade, u_flat, u_glow, u_pulse, u_neonAmt; uniform vec3 u_cam;
uniform vec3 u_ground, u_rim, u_core, u_core2, u_young, u_ember, u_neon; varying vec2 v;
void main(){
  // a slow camera: u_cam.xy pans, u_cam.z zooms; the field is periodic so the pan never ends
  vec2 uv = fract(u_cam.xy + (v - 0.5)/u_cam.z);
  vec4 t = texture2D(u_trail, uv);
  float b = t.b*0.5, act = t.r, age = t.g;
  // relief: the field as a low landscape lit from u_light
  float bx = (texture2D(u_trail, fract(uv + vec2(u_px.x, 0.0))).b - texture2D(u_trail, fract(uv - vec2(u_px.x, 0.0))).b)*0.5;
  float by = (texture2D(u_trail, fract(uv + vec2(0.0, u_px.y))).b - texture2D(u_trail, fract(uv - vec2(0.0, u_px.y))).b)*0.5;
  vec3 nrm = normalize(vec3(-bx*4.0, -by*4.0, 1.0));
  vec3 L = normalize(vec3(u_light, 0.9));
  float diff = clamp(dot(nrm, L), 0.0, 1.0);
  float spec = pow(clamp(dot(nrm, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0, 1.0), 28.0);
  float m = smoothstep(0.03, 0.30, b);
  // two hues share the tissue, in slow patches that drift across the field
  float w = 0.5 + 0.5*sin(6.2832*(uv.x*1.1 + 0.25*sin(u_time/95.0)) + u_time/70.0)*sin(6.2832*(uv.y*0.8 - u_time/80.0) + 1.7);
  vec3 core = mix(u_core, u_core2, smoothstep(0.2, 0.8, w));
  vec3 tissue = mix(u_rim, core, smoothstep(0.12, 0.30, b));
  tissue = mix(u_young, tissue, smoothstep(0.0, 0.9, age));
  tissue *= 0.70 + 0.48*diff;
  tissue += spec*0.12;
  vec3 col = mix(u_ground, tissue, m);
  // neon: edges glow in the grade's own light, more where the field is moving, flaring on events
  float edge = smoothstep(0.015, 0.09, length(vec2(bx, by)));
  float neon = u_neonAmt*u_glow*(1.0 + 1.5*u_pulse);
  col += u_neon*edge*(0.22 + 0.5*act)*neon;
  col += mix(u_neon, u_ember, 0.5)*act*(0.25 + 0.55*m)*(0.6 + 0.4*neon);
  col = mix(col, col*0.6 + u_ground*0.15, u_flat);
  col *= u_fade;
  col += (hash(gl_FragCoord.xy + fract(u_time)*100.0) - 0.5)*(1.5/255.0);
  gl_FragColor = vec4(col, 1.0);
}`;

// Text view of the field: box-filtered B at a coarse grid, for morphogen.ascii()
SH.ASCII = `
uniform sampler2D u_trail; uniform vec2 u_cell; varying vec2 v;
void main(){
  float b = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
    b += texture2D(u_trail, v + vec2(float(i), float(j))*u_cell*0.33).b;
  gl_FragColor = vec4(b/9.0, 0.0, 0.0, 1.0);
}`;

SH.PROBE = `
uniform sampler2D u_trail; varying vec2 v;
void main(){ vec2 s = readS(v); vec4 t = texture2D(u_trail, v); gl_FragColor = vec4(s.y, s.x, t.r, 1.0); }`;

SH.COPY = `
varying vec2 v;
void main(){ gl_FragColor = texture2D(u_state, v); }`;

// Bring a remembered pattern back into a dead field
SH.MERGE = `
uniform sampler2D u_mem; uniform float u_amt; varying vec2 v;
void main(){
  vec2 c = readS(v); vec2 m = readT(u_mem, v);
  gl_FragColor = writeS(vec2(c.x, max(c.y, m.y*u_amt)));
}`;

// Punch holes into a flat field so patterns can nucleate
SH.POKE = `
uniform vec2 u_px; uniform float u_seed; varying vec2 v;
void main(){
  vec2 c = readS(v); float h = 0.0;
  for (int i = 0; i < 12; i++) {
    vec2 p = vec2(hash(vec2(float(i)*3.7 + u_seed, 5.0)), hash(vec2(float(i)*9.1 + u_seed, 6.0)));
    p = 0.05 + 0.9*p;
    vec2 d = (v - p)/u_px;
    h += smoothstep(12.0, 5.0, length(d));
  }
  h = min(h, 1.0);
  gl_FragColor = writeS(vec2(mix(c.x, 1.0, h), c.y*(1.0 - 0.95*h)));
}`;

// Paint a small glyph (a texture of on/off cells) into the field: B only, A untouched
SH.STAMP = `
uniform sampler2D u_stamp; uniform vec4 u_rect; varying vec2 v;
void main(){
  vec2 c = readS(v);
  vec2 q = (v - u_rect.xy)/u_rect.zw;
  float s = 0.0;
  if (q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) s = texture2D(u_stamp, q).r;
  s = smoothstep(0.35, 0.65, s);
  gl_FragColor = writeS(vec2(c.x, max(c.y, 0.5*s)));
}`;
