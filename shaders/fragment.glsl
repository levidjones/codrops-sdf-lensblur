varying vec2 v_texcoord;

uniform vec2 u_mouse;
uniform vec2 u_resolution;
uniform float u_pixelRatio;
uniform sampler2D u_msdf;

#define GLYPH_COUNT 15

uniform vec4 u_glyphPos[GLYPH_COUNT];
uniform vec4 u_glyphUV[GLYPH_COUNT];
uniform float u_textWidth;
uniform float u_lineHeight;
uniform float u_distRange;

uniform float u_textScaleFactor;
uniform float u_blurMultiplier;
uniform float u_brightnessBoost;
uniform float u_mouseRadius;
uniform float u_mouseFalloff;
uniform float u_smoothK;
uniform vec4 u_textBBox; // (minX, minY, maxX, maxY) in font units

float median(float r, float g, float b) {
    return max(min(r, g), min(max(r, g), b));
}

// Rounded rectangle SDF (positive inside, negative outside)
float roundedRectSDF(vec2 p, vec2 center, vec2 halfSize, float r) {
    vec2 q = abs(p - center) - halfSize + r;
    return -(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r);
}

void main() {
    vec2 fragPos = gl_FragCoord.xy;

    // Mouse: CSS coords (Y-down) -> GL screen pixels (Y-up)
    vec2 mousePos = vec2(
        u_mouse.x * u_pixelRatio,
        u_resolution.y - u_mouse.y * u_pixelRatio
    );

    // --- Mouse influence ---
    float normMouseDist = length(fragPos - mousePos) * 2.0 / u_resolution.y;
    float sdfCircle = 1.0 - smoothstep(u_mouseRadius, u_mouseFalloff, normMouseDist);

    // Text layout in screen pixels
    float textScale = u_resolution.x * u_textScaleFactor / u_textWidth;
    float textBlockW = u_textWidth * textScale;
    float textBlockH = u_lineHeight * textScale;

    vec2 textOrigin = vec2(
        (u_resolution.x - textBlockW) * 0.5,
        (u_resolution.y + textBlockH) * 0.5
    );

    // Fragment in text-local space (font units, Y-down from top of line cell)
    vec2 textPos = vec2(
        (fragPos.x - textOrigin.x) / textScale,
        (textOrigin.y - fragPos.y) / textScale
    );

    // --- Per-glyph crisp SDF ---
    float screenPxRange = u_distRange * textScale;
    float distCrisp = -1e5;

    for (int i = 0; i < GLYPH_COUNT; i++) {
        vec4 gp = u_glyphPos[i];
        vec4 guv = u_glyphUV[i];
        vec2 gMin = gp.xy;
        vec2 gMax = gp.xy + gp.zw;

        vec2 nearest = clamp(textPos, gMin, gMax);
        float bboxDist = length(textPos - nearest);

        vec2 localUV = (nearest - gMin) / gp.zw;
        vec2 atlasUV = vec2(
            mix(guv.x, guv.z, localUV.x),
            mix(guv.y, guv.w, localUV.y)
        );
        vec3 msdfSample = texture2D(u_msdf, atlasUV).rgb;
        float sd = median(msdfSample.r, msdfSample.g, msdfSample.b);

        float d = screenPxRange * (sd - 0.5) - bboxDist * textScale;
        distCrisp = max(distCrisp, d);
    }

    // --- Envelope SDF: pill-shaped rounded rect bounding the text ---
    float padding = u_smoothK * 4.0; // padding in font units, controlled by smoothK
    vec2 bboxMin = u_textBBox.xy - padding;
    vec2 bboxMax = u_textBBox.zw + padding;
    vec2 bboxCenter = (bboxMin + bboxMax) * 0.5;
    vec2 bboxHalf = (bboxMax - bboxMin) * 0.5;
    float cornerR = min(bboxHalf.x, bboxHalf.y);

    // Envelope distance in screen pixels (positive inside, negative outside)
    float distEnvelope = roundedRectSDF(textPos, bboxCenter, bboxHalf, cornerR) * textScale;

    // Blend: per-glyph (crisp text) -> envelope (smooth glow)
    float dist = mix(distCrisp, distEnvelope, sdfCircle);

    // --- Variable blur ---
    float blurPx = mix(0.5, screenPxRange * u_blurMultiplier, sdfCircle);
    float sdf = smoothstep(-blurPx, blurPx, dist);

    // Brightness boost near mouse
    sdf *= mix(1.0, u_brightnessBoost, sdfCircle);

    gl_FragColor = vec4(vec3(sdf), 1.0);
}
