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
// the passage: the field folded into a kaleidoscopic tunnel and flown through
uniform float u_hyper, u_travel, u_rot, u_seg, u_aspect, u_break, u_dark, u_bloom, u_unfold, u_go, u_pair, u_spin; uniform vec3 u_spark, u_cream, u_gold;
// Nothing flashes: the light, the bands and the breathing all change under 1.5 Hz; only the pattern moves faster, as motion.
float breathe(){ return 1.0 + 0.06*u_hyper*sin(u_time*1.1); }
vec3 jewel(float i){
  i = mod(i, 5.0);
  if (i < 1.0) return vec3(0.86, 0.46, 0.32);   // clay
  if (i < 2.0) return vec3(0.80, 0.22, 0.50);   // rose
  if (i < 3.0) return vec3(0.16, 0.66, 0.64);   // teal
  if (i < 4.0) return vec3(0.48, 0.32, 0.86);   // violet
  return vec3(1.00, 0.80, 0.44);                // gold
}
vec2 tunnel(vec2 q, float rot, float segN, float scale, float trav, out float r, out float ang, out float depth, out float seam, out float petal){
  vec2 p = (q - 0.5)*vec2(u_aspect, 1.0);
  r = length(p); ang = atan(p.y, p.x);
  float rr = r*(1.0 + 0.035*u_hyper*sin(r*38.0 - u_time*5.0));
  float seg = 6.2832/segN;
  float a = mod(ang + rot, seg); a = abs(a - 0.5*seg);
  seam = min(a, 0.5*seg - a)*r;
  petal = floor(mod(ang + rot, 6.2832)/(0.5*seg));
  depth = scale*breathe()/max(rr, 0.015) + trav;
  return vec2(a/(0.5*seg)*0.5 + u_cam.x + 0.03*depth, depth + u_cam.y);
}
// The chrysanthemum: where a passage begins. Four layers of petals, each petal its own jewel,
// filled with the field and edged in light, unfolding and slowly turning in alternate directions.
// u_go carries you through its middle: the flower grows past you and the tunnel is behind it.
vec4 chrysanthemum(vec2 q, float bx, float by, out float outer){
  vec2 p = (q - 0.5)*vec2(u_aspect, 1.0);
  float S = 1.0 + 7.0*u_go*u_go;
  p /= S;
  float r = length(p), ang = atan(p.y, p.x);
  float unfold = u_unfold*(1.0 + 0.03*sin(u_time*1.1));
  vec3 col = vec3(0.012, 0.008, 0.02);
  float mask = smoothstep(0.78*unfold + 0.02, 0.70*unfold, r);
  outer = 1.0 - mask;
  for (int i = 0; i < 4; i++) {
    float k = float(i);
    float R = (0.66 - 0.14*k)*unfold;
    float N = k < 2.0 ? u_seg*2.0 : u_seg;
    float dir = mod(k, 2.0) < 0.5 ? 1.0 : -1.0;
    float t = (ang + dir*u_spin*(1.0 - 0.25*k))*N*0.5 + k*0.7;   // speeds 1, 3/4, 1/2, 1/4: seamless when spin wraps at 8 pi
    float rho = abs(cos(t));
    float e = R*(0.52 + 0.48*pow(rho, 0.7));
    float inside = smoothstep(e + 0.004, e - 0.004, r);
    // each layer casts a soft shadow on the one behind it, so the flower has depth
    col *= 1.0 - 0.55*smoothstep(e + 0.035, e, r)*(1.0 - inside);
    // stained glass, after a rose window: each petal is leaded into four panes (either side of the
    // midrib, inner and outer), each pane its own piece of glass, lit from behind, the field as its texture
    float tr = floor(t/3.14159 + 0.5);
    float idx = mod(tr, N);
    float tt = t - tr*3.14159;                       // -pi/2..pi/2 across the petal, 0 on the midrib
    float along = r/max(e, 0.01);
    float side = tt > 0.0 ? 1.0 : 0.0, outerPane = along > 0.56 ? 1.0 : 0.0;
    vec3 jw = jewel(idx + k*2.0);
    vec3 glass = mix(jw, jewel(idx + k*2.0 + 1.0 + side), 0.10 + 0.10*outerPane);
    vec2 fuv = vec2(fract(t/3.14159 + 0.5)*0.30 + bx + k*0.21, r/max(R, 0.01)*0.45 + by + k*0.17 - u_time*0.01);
    float b = texture2D(u_trail, fract(fuv)).b*0.5;
    float cell = smoothstep(0.10, 0.28, b);
    // distances to the leads, in screen units: the outline, the joins between petals, the midrib, the cross bar
    float arcw = r*2.0/N;
    float dOut = abs(r - e);
    float dJoin = (1.5708 - abs(tt))*arcw;
    float dRib = abs(tt)*arcw;
    float dBar = abs(r - 0.56*e);
    float dPane = min(min(dJoin, dRib), dBar);
    float dLead = min(dOut, dPane);
    // light comes through: brightest in the middle of a pane, the glass mottled by the living field
    float through = 0.70 + 0.62*smoothstep(0.0, 0.05, dPane)*smoothstep(0.0, 0.05, dOut);
    glass = mix(glass, glass*glass*1.7, 0.45);   // deeper, richer, the way lit glass reads
    vec3 pc = glass*through*(0.86 + 0.22*cell);
    pc += mix(glass, u_cream, 0.6)*0.10*cell*smoothstep(0.02, 0.06, dPane);
    // the leads: dark came with a faint bright edge where the light catches it
    float lw = 0.0042;
    float lead = 1.0 - smoothstep(lw*0.55, lw, dLead);
    float catchLight = exp(-pow((dLead - lw)/0.0012, 2.0));
    pc = mix(pc, vec3(0.025, 0.02, 0.03), lead);
    pc += mix(glass, u_cream, 0.7)*catchLight*0.22;
    col = mix(col, pc*(0.84 + 0.06*k), inside);
    // the outline lead belongs to the petal, so draw it where the petal edge is, over what lies behind
    col = mix(col, vec3(0.025, 0.02, 0.03), (1.0 - smoothstep(lw*0.55, lw, dOut))*step(r, e + lw));
  }
  // the eye: a small core of light that becomes the way through
  float eye = exp(-r*r*900.0)*(1.0 - u_go);
  col += u_cream*eye*0.9;
  float hole = smoothstep(0.02 + 0.30*u_go, 0.0 + 0.28*u_go, r);
  return vec4(col, mask*(1.0 - hole)*u_bloom);
}
vec3 shade(vec2 uv, vec3 neonCol, float lift){
  uv = fract(uv);
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
  float neon = u_neonAmt*u_glow*(1.0 + 1.5*u_pulse) + lift;
  col += neonCol*edge*(0.22 + 0.5*act)*neon;
  col += mix(neonCol, u_ember, 0.5)*act*(0.25 + 0.55*m)*(0.6 + 0.4*neon);
  return col;
}
void main(){
  // a slow camera: u_cam.xy pans, u_cam.z zooms; the field is periodic so the pan never ends
  vec3 col = shade(u_cam.xy + (v - 0.5)/u_cam.z, u_neon, 0.0);
  if (u_hyper > 0.001) {
    float r, ang, depth, seam, petal;
    vec2 tuv = tunnel(v, u_rot, u_seg, 0.22, u_travel, r, ang, depth, seam, petal);
    // the light walks a three-stop cycle down the tunnel: clay, cream, gold; no rainbow
    float cyc = fract(depth*0.35 - u_time*0.06)*3.0;
    vec3 irid = cyc < 1.0 ? mix(u_spark, u_cream, cyc) : cyc < 2.0 ? mix(u_cream, u_gold, cyc - 1.0) : mix(u_gold, u_spark, cyc - 2.0);
    vec3 tc = shade(tuv, irid, 0.9*u_hyper);
    float ringI = floor(depth*0.6);
    // the tunnel keeps to two jewels per passage, alternating by petal and ring: stained glass, never a spectrum
    vec3 jw = mod(petal + ringI, 2.0) < 1.0 ? jewel(u_pair) : jewel(u_pair + 2.0);
    float lum = dot(tc, vec3(0.3, 0.59, 0.11));
    // tint the pattern only; empty field stays dark
    float body0 = smoothstep(0.06, 0.40, texture2D(u_trail, fract(tuv)).b*0.5);
    tc = mix(tc, lum*jw*2.1, 0.62*u_hyper*body0);
    // a faint warm/cool split, a screen pixel or two wide: the edges vibrate without turning to rainbow
    float fo = min(0.02, 0.0005/max(r*r, 0.0001));
    float b0 = texture2D(u_trail, fract(tuv)).b;
    float bR = texture2D(u_trail, fract(tuv + vec2(0.0, fo))).b;
    float bB = texture2D(u_trail, fract(tuv - vec2(0.0, fo))).b;
    tc += (u_spark*(bR - b0) + u_cream*(bB - b0)*0.6)*0.5*u_hyper;
    // a second passage inside the first, twice the folds, turning the other way, farther down
    float r2, ang2, depth2, seam2, petal2;
    vec2 tuv2 = tunnel(v, -u_rot*1.6 + 0.5, u_seg*2.0, 0.13, u_travel*1.4 + 7.0, r2, ang2, depth2, seam2, petal2);
    float b2 = texture2D(u_trail, fract(tuv2)).b*0.5;
    float fog = smoothstep(0.02, 0.30 + 0.35*u_break, r);
    tc += mix(jewel(u_pair + 2.0), u_cream, 0.35)*smoothstep(0.10, 0.28, b2)*0.30*u_hyper*fog;
    // the architecture the field hangs on: the mirror seams and the rings between them, faintly lit
    float seams = exp(-pow(seam/0.0028, 2.0));
    float rf = fract(depth*0.6);
    float ring = smoothstep(0.03, 0.0, min(rf, 1.0 - rf));
    tc += mix(irid, u_cream, 0.5)*(seams*0.40 + ring*0.22)*u_hyper*fog*(0.7 + 0.3*sin(depth*3.0 - u_time*2.0));
    // bands of light travel outward with the flight; slow, low, never a flash
    tc *= 1.0 + 0.10*u_hyper*sin(depth*9.0 - u_time*6.0);
    // far away the tunnel fogs into the light at its end; in a breakthrough the light comes forward
    float breath = 0.85 + 0.15*sin(u_time*1.3) + 0.4*u_pulse;
    // the dark passage: the walls keep only their outlines, lit in cool jewels, and the far end is a deep void
    if (u_dark > 0.001) {
      float ex = (texture2D(u_trail, fract(tuv + vec2(u_px.x, 0.0))).b - texture2D(u_trail, fract(tuv - vec2(u_px.x, 0.0))).b)*0.5;
      float ey = (texture2D(u_trail, fract(tuv + vec2(0.0, u_px.y))).b - texture2D(u_trail, fract(tuv - vec2(0.0, u_px.y))).b)*0.5;
      float outline = smoothstep(0.07, 0.15, length(vec2(ex, ey)));
      vec3 cool = mod(petal + ringI, 2.0) < 1.0 ? jewel(u_pair) : jewel(u_pair + 2.0);
      vec3 dk = (tc*0.04 + cool*outline*0.45)*smoothstep(0.10, 0.85, r);
      tc = mix(tc, dk, u_dark);
    }
    vec3 far = mix(u_spark, u_cream, 0.35 + 0.5*u_break);
    vec3 void_ = vec3(0.010, 0.006, 0.022);
    float fogX = mix(fog, smoothstep(0.05, 0.50 + 0.30*u_break, r), u_dark);
    tc = mix(mix(far*(0.9 + 0.2*u_break)*breath, void_, u_dark), tc, fogX);
    float rays = pow(abs(cos(ang*6.0 + u_rot*2.0)), 24.0)*exp(-r*(5.0 - 3.0*u_break));
    tc += (u_cream*exp(-r*r*90.0/(1.0 + 4.0*u_break))*(1.2 - 0.3*u_break) + u_spark*rays*0.55)*breath*u_hyper*(1.0 - u_dark);
    // what comes out of the dark: the field itself, folded into a slow still form at the center,
    // not flown through; it turns, breathes and draws nearer as the dark comes forward
    if (u_dark > 0.001) {
      float segB = 6.2832/u_seg;
      float aB = mod(ang - u_rot*0.5, segB); aB = abs(aB - 0.5*segB);
      float near = 0.55 + 0.45*u_break;
      vec2 uvB = vec2(aB/(0.5*segB)*0.35 + u_cam.x + 0.31, r*(1.6 - 0.7*near) - u_time*0.012 + u_cam.y + 0.53);
      float bB2 = texture2D(u_trail, fract(uvB)).b*0.5;
      float body = smoothstep(0.12, 0.30, bB2);
      float bx2 = (texture2D(u_trail, fract(uvB + vec2(u_px.x, 0.0))).b - texture2D(u_trail, fract(uvB - vec2(u_px.x, 0.0))).b)*0.5;
      float by2 = (texture2D(u_trail, fract(uvB + vec2(0.0, u_px.y))).b - texture2D(u_trail, fract(uvB - vec2(0.0, u_px.y))).b)*0.5;
      float lineB = smoothstep(0.04, 0.12, length(vec2(bx2, by2)));
      float reach = (1.0 - smoothstep(0.06 + 0.16*near, 0.10 + 0.24*near, r))*(1.0 - 0.8*fogX);
      float slow = 0.75 + 0.25*sin(u_time*0.9 + r*6.0);
      vec3 hue = mix(jewel(u_pair + 1.0), u_cream, 0.2);
      tc += (hue*lineB*0.75 + hue*body*0.08)*reach*slow*u_dark*u_hyper*(0.35 + 0.65*near);
      // a thin ring of light where the void begins
      tc += vec3(0.40, 0.30, 0.75)*exp(-pow((r - (0.30 + 0.35*u_break)*0.55)/0.012, 2.0))*0.35*u_dark*u_hyper;
    }
    // the passage opens from the middle; its rim burns while it is opening or closing
    float R = u_hyper*1.35;
    float inside = smoothstep(R, R - 0.25, r);
    // before you go through, the flower hangs over the dimmed field; the tunnel shows only through its middle
    if (u_bloom > 0.001) { float outer; vec4 fl = chrysanthemum(v, u_cam.x + 0.13, u_cam.y + 0.41, outer); tc = mix(tc, col*0.35, outer*u_bloom); tc = mix(tc, fl.rgb, fl.a); }
    col = mix(col, tc, inside);
    float rim = exp(-pow((r - (R - 0.13))/0.035, 2.0))*u_hyper*(1.0 - u_hyper)*4.0;
    col += mix(u_spark, u_cream, 0.4)*rim*0.8;
  }
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
