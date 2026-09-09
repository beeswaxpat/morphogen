// morphogen — tiny WebGL engine: context probe, render targets, programs, draws
const E = (() => {
  function createGL(canvas, opts, force) {
    opts = Object.assign({ antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }, opts || {});
    let gl = canvas.getContext('webgl2', opts), v2 = !!gl;
    if (!gl) gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) return null;
    gl.getError();
    const tryFmt = (internal, type) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, 4, 4, 0, gl.RGBA, type, null);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(t);
      return ok;
    };
    let mode = 'u8', type = gl.UNSIGNED_BYTE, internal = gl.RGBA;
    const allow = m => !force || force === m;
    if (v2) {
      const cf = gl.getExtension('EXT_color_buffer_float');
      if (allow('f32') && cf && tryFmt(gl.RGBA32F, gl.FLOAT)) { mode = 'f32'; internal = gl.RGBA32F; type = gl.FLOAT; }
      else if (allow('f16') && (cf || gl.getExtension('EXT_color_buffer_half_float')) && tryFmt(gl.RGBA16F, gl.HALF_FLOAT)) { mode = 'f16'; internal = gl.RGBA16F; type = gl.HALF_FLOAT; }
    } else {
      if (allow('f32') && gl.getExtension('OES_texture_float') && tryFmt(gl.RGBA, gl.FLOAT)) { mode = 'f32'; type = gl.FLOAT; }
      else { const h = gl.getExtension('OES_texture_half_float'); if (allow('f16') && h && tryFmt(gl.RGBA, h.HALF_FLOAT_OES)) { mode = 'f16'; type = h.HALF_FLOAT_OES; } }
    }
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    return { gl, v2, mode, type, internal, buf };
  }

  function target(ctx, w, h, kind, filter) {
    const gl = ctx.gl;
    const internal = kind === 'state' ? ctx.internal : gl.RGBA;
    const type = kind === 'state' ? ctx.type : gl.UNSIGNED_BYTE;
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    const f = filter || gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h };
  }

  function del(ctx, t) { if (!t) return; ctx.gl.deleteFramebuffer(t.fb); ctx.gl.deleteTexture(t.tex); }

  function program(ctx, vs, fs) {
    const gl = ctx.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s) + '\n' + src);
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog));
    const u = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(prog, i); u[info.name] = { loc: gl.getUniformLocation(prog, info.name), type: info.type }; }
    return { prog, u, a: gl.getAttribLocation(prog, 'p') };
  }

  function draw(ctx, p, tgt, uni) {
    const gl = ctx.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, tgt ? tgt.fb : null);
    gl.viewport(0, 0, tgt ? tgt.w : gl.drawingBufferWidth, tgt ? tgt.h : gl.drawingBufferHeight);
    gl.useProgram(p.prog);
    let unit = 0;
    for (const name in uni) {
      const u = p.u[name]; if (!u) continue; const val = uni[name];
      switch (u.type) {
        case gl.SAMPLER_2D: gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, val); gl.uniform1i(u.loc, unit); unit++; break;
        case gl.FLOAT: gl.uniform1f(u.loc, val); break;
        case gl.FLOAT_VEC2: gl.uniform2f(u.loc, val[0], val[1]); break;
        case gl.FLOAT_VEC3: gl.uniform3f(u.loc, val[0], val[1], val[2]); break;
        case gl.FLOAT_VEC4: gl.uniform4f(u.loc, val[0], val[1], val[2], val[3]); break;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, ctx.buf);
    gl.enableVertexAttribArray(p.a); gl.vertexAttribPointer(p.a, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return { createGL, target, del, program, draw };
})();
