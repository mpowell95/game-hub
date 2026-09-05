// golf/js/club-art.js - the club-head artwork, and the map from a club id to its symbol.
//
// FIVE DRAWINGS FOR FOURTEEN CLUBS. Matt drew these in Claude Design after three rounds of my own
// traced attempts came back wrong ("None of the clubs are even shaped right"). They arrived as one
// SVG on ONE SHARED CANVAS, which is the thing that matters here: the driver's head really is bigger
// than the 3 wood's, the wedge is more lofted than the iron, and that stays true only if every
// symbol is drawn through the SAME viewBox. Do not give a club its own viewBox to "make it fit" -
// that is exactly what throws the bag's proportions away.
//
// The putter's shaft leaves the head at its END, not out of the middle. That was Matt's first note
// on my version and it is the quickest way to tell this art from the placeholder it replaced.
//
// EVERY id IN THE DEFS IS PREFIXED `gf-`. The defs are injected into the hub's own document, where
// a gradient called `steelFace` or a clip called `headClip` would sooner or later collide with
// another game's markup - and an id collision in SVG is silent, it just paints the wrong thing.

/** The shared viewBox. Measured from the union of all five symbols' bounding boxes, plus a margin:
 *  driver 165x167 at (9,12), wood 129x131 at (28,40), iron 125x127 at (38,37), wedge 132x135 at
 *  (34,33), putter 147x111 at (27,45). */
export const CLUB_ART_VIEWBOX = '4 6 176 178';

/** Which drawing a club uses. Fourteen clubs, five heads. */
export function clubSymbol(id) {
  if (id === 'putter') return 'putterArt';
  if (id === 'driver') return 'driverArt';
  if (id.endsWith('wood')) return 'woodArt';
  if (id.endsWith('wedge')) return 'wedgeArt';
  return 'ironArt';
}

/** The art's own centre, from the union of the five bounding boxes. Every per-club scale below is
 *  taken ABOUT THIS POINT, so a club grows or shrinks in place instead of drifting toward a corner
 *  of the tile. */
const ART_CX = 92;
const ART_CY = 95;

/** PER-CLUB SIZE, on top of the drawing it shares.
 *
 *  Matt: *"make the 3 wood a little bigger than the 5 wood. it's ok if you have to make the driver
 *  bigger as well so there's a clear step down."* The two woods share one drawing, so without this
 *  they rendered identically - a 3 wood and a 5 wood were the same picture with a different name.
 *
 *  Rendered heights in the 54 px tile: driver 53.6, 3 wood 39.0, 5 wood 32.6. Steps of about 15 px
 *  and 6 px, which reads as a ladder rather than as three sizes of the same thing.
 *
 *  THE DRIVER'S 1.06 IS THE LARGEST THAT STILL FITS `CLUB_ART_VIEWBOX`. Scaled about the centre
 *  above it lands at x 4.2-179.6 and y 7.0-183.7 against a box of x 4-180, y 6-184 - so it fills
 *  the frame and does not clip, and anything larger would need the viewBox widened, which shrinks
 *  every OTHER club in the tile. Check that arithmetic before raising it.
 *
 *  Anything absent is 1: the irons and wedges all share one size on purpose, because there are
 *  eight irons and no sensible ladder to draw between a 4 and a 5. */
const CLUB_SCALE = { driver: 1.06, '3wood': 0.98, '5wood': 0.82 };

export function clubScale(id) { return CLUB_SCALE[id] || 1; }

/** One `<svg>` for a club tile. The symbol lives in the defs block injected once per screen. */
export function clubArtSVG(id) {
  const k = clubScale(id);
  const g = k === 1 ? '' : ` transform="translate(${(ART_CX * (1 - k)).toFixed(2)},${(ART_CY * (1 - k)).toFixed(2)}) scale(${k})"`;
  return `<svg class="gf-clubart" viewBox="${CLUB_ART_VIEWBOX}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><use href="#gf-${clubSymbol(id)}"${g}/></svg>`;
}

/** The gradients, clips and paths themselves. Injected ONCE into a zero-size svg on the play
 *  screen; every tile then references a symbol out of it, so switching clubs costs one `<use>`
 *  rather than re-parsing 19 KB of markup. */
export const CLUB_ART_DEFS = `<defs>
      <linearGradient id="gf-steelHead" x1="0.1" y1="0" x2="0.55" y2="1">
        <stop offset="0" stop-color="#f6f8f9" />
        <stop offset="0.3" stop-color="#d2d9dd" />
        <stop offset="0.6" stop-color="#9ba4ab" />
        <stop offset="1" stop-color="#6c747a" />
      </linearGradient>
      <linearGradient id="gf-steelFace" x1="0" y1="0" x2="1" y2="0.3">
        <stop offset="0" stop-color="#aeb7bd" />
        <stop offset="0.55" stop-color="#e9eef1" />
        <stop offset="1" stop-color="#b9c1c6" />
      </linearGradient>
      <linearGradient id="gf-steelShaft" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#eef1f3" />
        <stop offset="0.45" stop-color="#b4bbc0" />
        <stop offset="1" stop-color="#7c848a" />
      </linearGradient>
      <linearGradient id="gf-faceGlow" x1="0.05" y1="0" x2="0.95" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.5" />
        <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.17" />
        <stop offset="1" stop-color="#ffffff" stop-opacity="0" />
      </linearGradient>

      <clipPath id="gf-headClip">
        <path d="M 34,103.07 L 132,94 C 136,93 139,86 141.1,78.2 L 158.15,18.74 A 7.2 7.2 0 0 1 171.99,22.71 L 154.94,82.17 C 158,95 157,104 155,113 C 155,129 147,145 131,156 C 112,167 78,170 56,164 C 34,158 22,142 20.5,126 C 19.5,115 24,105 34,103.07 Z" />
      </clipPath>
      <clipPath id="gf-faceClip">
        <path d="M 44,113.9 L 129,106 C 137,105.5 141,111 141,120 C 141,132 136,143 125,148 C 110,156 80,158 60,153 C 42,148 32,137 31.5,124 C 31,116 35,114.6 44,113.9 Z" />
      </clipPath>

      <g id="gf-driverArt">
        <g transform="translate(-8,4) rotate(5.29 88 130)">
          <path d="M 34,103.07 L 132,94 C 136,93 139,86 141.1,78.2 L 158.15,18.74 A 7.2 7.2 0 0 1 171.99,22.71 L 154.94,82.17 C 158,95 157,104 155,113 C 155,129 147,145 131,156 C 112,167 78,170 56,164 C 34,158 22,142 20.5,126 C 19.5,115 24,105 34,103.07 Z" fill="url(#gf-steelHead)" stroke="#0b0c0d" stroke-width="{{ outline }}" stroke-linejoin="round" />
          <g clip-path="url(#gf-headClip)">
            <path d="M 34,103.1 L 132,94 C 145,92.6 155,100 155,113 C 150,102 141,99 130,100 L 38,108.5 C 32,109.5 31,105 34,103.1 Z" fill="#ffffff" opacity="0.2" />
            <path d="M 56,164 C 78,170 112,167 131,156 C 112,163 80,164 60,159 Z" fill="#0b0c0d" opacity="0.2" />
            <path d="M 141.1,78.2 L 158.15,18.74 A 7.2 7.2 0 0 1 171.99,22.71 L 154.94,82.17 Z" fill="url(#gf-steelShaft)" />
            <path d="M 146.72,58.59 L 162.1,63" stroke="#0b0c0d" stroke-width="4" stroke-linecap="round" opacity="0.45" />
            <path d="M 153.85,48.98 L 160.85,24.56" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.42" />
          </g>
          <path d="M 34,103.07 L 132,94 C 136,93 139,86 141.1,78.2 L 158.15,18.74 A 7.2 7.2 0 0 1 171.99,22.71 L 154.94,82.17 C 158,95 157,104 155,113 C 155,129 147,145 131,156 C 112,167 78,170 56,164 C 34,158 22,142 20.5,126 C 19.5,115 24,105 34,103.07 Z" fill="none" stroke="#0b0c0d" stroke-width="{{ outline }}" stroke-linejoin="round" />
          <path d="M 44,113.9 L 129,106 C 137,105.5 141,111 141,120 C 141,132 136,143 125,148 C 110,156 80,158 60,153 C 42,148 32,137 31.5,124 C 31,116 35,114.6 44,113.9 Z" fill="url(#gf-steelFace)" stroke="#0b0c0d" stroke-width="4.4" stroke-linejoin="round" />
          <g clip-path="url(#gf-faceClip)">
            <path d="M 34,116 C 44,114.5 53,113.6 62,113 C 54,128 48,142 44,155 C 37,150 32,141 31,130 Z" fill="url(#gf-faceGlow)" />
            <path d="M 46,123.4 L 82,120" stroke="#8a939a" stroke-width="4.4" stroke-linecap="round" opacity="0.9" />
            <path d="M 92,119.1 L 124,116.1" stroke="#8a939a" stroke-width="4.4" stroke-linecap="round" opacity="0.9" />
            <path d="M 44,134.6 L 82,131" stroke="#8a939a" stroke-width="4.4" stroke-linecap="round" opacity="0.9" />
            <path d="M 92,130.1 L 128,126.7" stroke="#8a939a" stroke-width="4.4" stroke-linecap="round" opacity="0.9" />
            <path d="M 52,144.9 L 82,142" stroke="#8a939a" stroke-width="4.4" stroke-linecap="round" opacity="0.9" />
            <path d="M 92,141.1 L 120,138.5" stroke="#8a939a" stroke-width="4.4" stroke-linecap="round" opacity="0.9" />
          </g>
        </g>
      </g>

      <clipPath id="gf-headClipW">
        <path d="M 12,1.8 L 88,0 C 88.4,-2 88.6,-4.5 88.93,-6.57 L 117.25,-79.26 A 7.2 7.2 0 0 1 130.73,-74.16 L 103.9,-0.9 C 103,3 102,7 102,13 C 102,24 98,34 88,41 C 76,47 50,49 34,45 C 15,40 3.5,30 2,18 C 1.2,10 5,3 12,1.8 Z" />
      </clipPath>
      <clipPath id="gf-faceClipW">
        <path d="M 20,9.8 L 86,8 C 91,8 93.5,11 93.5,16.5 C 93.5,24 90,31 82.5,35.5 C 71,40.5 50,41.5 36,37.5 C 21,33.5 10.8,26.5 10.4,17.5 C 10,11.8 13.5,10.3 20,9.8 Z" />
      </clipPath>

      <g id="gf-woodArt">
        <g transform="translate(26.35,124)">
          <path d="M 12,1.8 L 88,0 C 88.4,-2 88.6,-4.5 88.93,-6.57 L 117.25,-79.26 A 7.2 7.2 0 0 1 130.73,-74.16 L 103.9,-0.9 C 103,3 102,7 102,13 C 102,24 98,34 88,41 C 76,47 50,49 34,45 C 15,40 3.5,30 2,18 C 1.2,10 5,3 12,1.8 Z" fill="url(#gf-steelHead)" stroke="#0b0c0d" stroke-width="{{ outline }}" stroke-linejoin="round" />
          <g clip-path="url(#gf-headClipW)">
            <path d="M 12,1.8 L 88,0 C 95,0 102,5 102,13 C 99,4.5 93,2 87,2.6 L 16,4.6 C 11,5 10,2.5 12,1.8 Z" fill="#ffffff" opacity="0.2" />
            <path d="M 34,45 C 50,49 76,47 88,41 C 76,44.5 50,46 36,42 Z" fill="#0b0c0d" opacity="0.2" />
            <path d="M 88.93,-6.57 L 117.25,-79.26 A 7.2 7.2 0 0 1 130.73,-74.16 L 103.9,-0.9 Z" fill="url(#gf-steelShaft)" />
            <path d="M 98.13,-30.9 L 113.09,-25.24" stroke="#0b0c0d" stroke-width="4" stroke-linecap="round" opacity="0.45" />
            <path d="M 107.37,-42.36 L 118.69,-72.3" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.42" />
          </g>
          <path d="M 12,1.8 L 88,0 C 88.4,-2 88.6,-4.5 88.93,-6.57 L 117.25,-79.26 A 7.2 7.2 0 0 1 130.73,-74.16 L 103.9,-0.9 C 103,3 102,7 102,13 C 102,24 98,34 88,41 C 76,47 50,49 34,45 C 15,40 3.5,30 2,18 C 1.2,10 5,3 12,1.8 Z" fill="none" stroke="#0b0c0d" stroke-width="{{ outline }}" stroke-linejoin="round" />
          <path d="M 20,9.8 L 86,8 C 91,8 93.5,11 93.5,16.5 C 93.5,24 90,31 82.5,35.5 C 71,40.5 50,41.5 36,37.5 C 21,33.5 10.8,26.5 10.4,17.5 C 10,11.8 13.5,10.3 20,9.8 Z" fill="url(#gf-steelFace)" stroke="#0b0c0d" stroke-width="4.4" stroke-linejoin="round" />
          <g clip-path="url(#gf-faceClipW)">
            <path d="M 15,9.6 C 24,9 33,8.6 42,8.4 C 36,20 30,30 27,38 C 18,33 11.5,25 11,17 Z" fill="url(#gf-faceGlow)" />
            <path d="M 20,16 L 46,16" stroke="#8a939a" stroke-width="3.4" stroke-linecap="round" opacity="0.9" />
            <path d="M 54,16 L 86,16" stroke="#8a939a" stroke-width="3.4" stroke-linecap="round" opacity="0.9" />
            <path d="M 18,22.5 L 46,22.5" stroke="#8a939a" stroke-width="3.4" stroke-linecap="round" opacity="0.9" />
            <path d="M 54,22.5 L 86,22.5" stroke="#8a939a" stroke-width="3.4" stroke-linecap="round" opacity="0.9" />
            <path d="M 28,29 L 46,29" stroke="#8a939a" stroke-width="3.4" stroke-linecap="round" opacity="0.9" />
            <path d="M 54,29 L 82,29" stroke="#8a939a" stroke-width="3.4" stroke-linecap="round" opacity="0.9" />
          </g>
        </g>
      </g>

      <clipPath id="gf-headClipI">
        <path d="M 39.55,114.11 C 54.37,113.4 82.79,126.26 106.71,136.47 L 141.09,48.3 A 7.215 7.215 0 0 1 154.53,53.54 L 118.02,147.18 C 119,155 117,163 112,167.5 C 109,170.3 106,171 101,171 L 51,171 C 41,170.5 37.86,167.61 32.98,159.86 C 28.19,152.24 30.77,133.71 32.5,125 C 34,120 35.39,114.88 39.55,114.11 Z" />
      </clipPath>
      <clipPath id="gf-faceClipI">
        <path d="M 46,114.49 C 59.8,116.44 80.15,125.07 99,133.16 L 98,168 Q 95,171 92,171 L 56,171 Q 53,171 50,168 Z" />
      </clipPath>

      <g id="gf-ironArt">
        <g transform="translate(7.63,-7.24)">
          <path d="M 39.55,114.11 C 54.37,113.4 82.79,126.26 106.71,136.47 L 141.09,48.3 A 7.215 7.215 0 0 1 154.53,53.54 L 118.02,147.18 C 119,155 117,163 112,167.5 C 109,170.3 106,171 101,171 L 51,171 C 41,170.5 37.86,167.61 32.98,159.86 C 28.19,152.24 30.77,133.71 32.5,125 C 34,120 35.39,114.88 39.55,114.11 Z" fill="url(#gf-steelHead)" stroke="#0b0c0d" stroke-width="{{ outline }}" stroke-linejoin="round" />
          <g clip-path="url(#gf-headClipI)">
            <path d="M 39.55,114.11 C 54.37,113.4 82.79,126.26 106.71,136.47 L 105,141.2 C 81.5,131.2 54,118.7 40.3,119.3 C 37,119.4 36.9,115 39.55,114.11 Z" fill="#ffffff" opacity="0.2" />
            <path d="M 51,171 L 101,171 C 106,171 109,170.3 112,167.5 C 108,169.3 104,168 100,168 L 52,168 C 47.5,168 45,169.3 43.5,167 C 45,169.6 47,171 51,171 Z" fill="#0b0c0d" opacity="0.2" />
            <path d="M 106.71,136.47 L 141.09,48.3 A 7.215 7.215 0 0 1 154.53,53.54 L 118.02,147.18 Z" fill="url(#gf-steelShaft)" />
            <path d="M 118.05,107.4 L 132.96,113.21" stroke="#0b0c0d" stroke-width="4" stroke-linecap="round" opacity="0.45" />
            <path d="M 128.17,93 L 142.27,56.85" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.42" />
          </g>
          <path d="M 39.55,114.11 C 54.37,113.4 82.79,126.26 106.71,136.47 L 141.09,48.3 A 7.215 7.215 0 0 1 154.53,53.54 L 118.02,147.18 C 119,155 117,163 112,167.5 C 109,170.3 106,171 101,171 L 51,171 C 41,170.5 37.86,167.61 32.98,159.86 C 28.19,152.24 30.77,133.71 32.5,125 C 34,120 35.39,114.88 39.55,114.11 Z" fill="none" stroke="#0b0c0d" stroke-width="{{ outline }}" stroke-linejoin="round" />
          <path d="M 46,114.49 C 59.8,116.44 80.15,125.07 99,133.16 L 98,168 Q 95,171 92,171 L 56,171 Q 53,171 50,168 Z" fill="url(#gf-steelFace)" stroke="#0b0c0d" stroke-width="4.4" stroke-linejoin="round" />
          <g clip-path="url(#gf-faceClipI)">
            <path d="M 46,114.49 C 56,116.3 66,119.6 76,123.5 C 68,140 62,156 59,171 L 52,171 Q 50,169 50,167.5 Z" fill="url(#gf-faceGlow)" />
            <path d="M 50.5,123.7 L 61.7,123.7" stroke="#8a939a" stroke-width="2.2" stroke-linecap="round" opacity="0.9" />
            <path d="M 50.8,127.5 L 72.3,127.5" stroke="#8a939a" stroke-width="2.2" stroke-linecap="round" opacity="0.9" />
            <path d="M 51.1,131.4 L 81.9,131.4" stroke="#8a939a" stroke-width="2.2" stroke-linecap="round" opacity="0.9" />
            <path d="M 51.4,135.2 L 91.1,135.2" stroke="#8a939a" stroke-width="2.2" stroke-linecap="round" opacity="0.9" />
            <path d="M 51.5,139.1 L 95,139.1" stroke="#8a939a" stroke-width="2.2" stroke-linecap="round" opacity="0.9" />
            <path d="M 51.8,142.9 L 95,142.9" stroke="#8a939a" stroke-width="2.2" stroke-linecap="round" opacity="0.9" />
            <path d="M 52.1,146.8 L 94.8,146.8" stroke="#8a939a" stroke-width="2.2" stroke-linecap="round" opacity="0.9" />
            <path d="M 52.4,150.6 L 94.7,150.6" stroke="#8a939a" stroke-width="2.2" stroke-linecap="round" opacity="0.9" />
            <path d="M 52.7,154.5 L 94.5,154.5" stroke="#8a939a" stroke-width="2.2" stroke-linecap="round" opacity="0.9" />
            <path d="M 53,158.3 L 94.5,158.3" stroke="#8a939a" stroke-width="2.2" stroke-linecap="round" opacity="0.9" />
            <path d="M 53.3,162.2 L 94.4,162.2" stroke="#8a939a" stroke-width="2.2" stroke-linecap="round" opacity="0.9" />
            <path d="M 53.6,166 L 94.2,166" stroke="#8a939a" stroke-width="2.2" stroke-linecap="round" opacity="0.9" />
          </g>
          <path d="M 39.55,114.11 C 54.37,113.4 82.79,126.26 106.71,136.47 L 141.09,48.3 A 7.215 7.215 0 0 1 154.53,53.54 L 118.02,147.18 C 119,155 117,163 112,167.5 C 109,170.3 106,171 101,171 L 51,171 C 41,170.5 37.86,167.61 32.98,159.86 C 28.19,152.24 30.77,133.71 32.5,125 C 34,120 35.39,114.88 39.55,114.11 Z" fill="none" stroke="#0b0c0d" stroke-width="{{ outline }}" stroke-linejoin="round" />
        </g>
      </g>

      <clipPath id="gf-headClipS">
        <path d="M 37,105 C 53,104.5 84,119 110,131 L 145.24,40.63 A 7.215 7.215 0 0 1 158.68,45.87 L 121.26,141.84 C 122,150 120,159.5 114.5,165 C 111,169 107.5,171 102,171 L 50,171 C 39,170.5 35,167 30,158.5 C 25,150 27.5,124 29.5,114 C 31,108 32.5,105.8 37,105 Z" />
      </clipPath>
      <clipPath id="gf-faceClipS">
        <path d="M 44,106.5 C 60,108 84,122 102,128.5 L 101,164 Q 98,168 94,168 L 54,168 Q 50,168 48,164 Z" />
      </clipPath>

      <g id="gf-wedgeArt">
        <g transform="translate(7.01,-3.41)">
          <path d="M 37,105 C 53,104.5 84,119 110,131 L 145.24,40.63 A 7.215 7.215 0 0 1 158.68,45.87 L 121.26,141.84 C 122,150 120,159.5 114.5,165 C 111,169 107.5,171 102,171 L 50,171 C 39,170.5 35,167 30,158.5 C 25,150 27.5,124 29.5,114 C 31,108 32.5,105.8 37,105 Z" fill="url(#gf-steelHead)" stroke="#0b0c0d" stroke-width="{{ outline }}" stroke-linejoin="round" />
          <g clip-path="url(#gf-headClipS)">
            <path d="M 37,105 C 53,104.5 84,119 110,131 L 108.3,135.7 C 83,124.2 53.5,109.8 38,109.8 C 34.6,109.8 34.3,105.9 37,105 Z" fill="#ffffff" opacity="0.2" />
            <path d="M 42,163.5 L 106,163.5 L 105,171 L 44,171 Z" fill="#0b0c0d" opacity="0.26" />
            <path d="M 54,169 L 100,169" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" opacity="0.3" />
            <path d="M 50,171 L 102,171 C 107.5,171 111,169 114.5,165 C 110,167.6 105,168 101,168 L 51,168 C 46,168 43,169 41,166.5 C 43,169.6 46,171 50,171 Z" fill="#0b0c0d" opacity="0.2" />
            <path d="M 110,131 L 145.24,40.63 A 7.215 7.215 0 0 1 158.68,45.87 L 121.26,141.84 Z" fill="url(#gf-steelShaft)" />
            <path d="M 121.63,101.19 L 136.54,107" stroke="#0b0c0d" stroke-width="4" stroke-linecap="round" opacity="0.45" />
            <path d="M 131.89,86.41 L 146.35,49.33" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.42" />
          </g>
          <path d="M 37,105 C 53,104.5 84,119 110,131 L 145.24,40.63 A 7.215 7.215 0 0 1 158.68,45.87 L 121.26,141.84 C 122,150 120,159.5 114.5,165 C 111,169 107.5,171 102,171 L 50,171 C 39,170.5 35,167 30,158.5 C 25,150 27.5,124 29.5,114 C 31,108 32.5,105.8 37,105 Z" fill="none" stroke="#0b0c0d" stroke-width="{{ outline }}" stroke-linejoin="round" />
          <path d="M 44,106.5 C 60,108 84,122 102,128.5 L 101,164 Q 98,168 94,168 L 54,168 Q 50,168 48,164 Z" fill="url(#gf-steelFace)" stroke="#0b0c0d" stroke-width="4.4" stroke-linejoin="round" />
          <g clip-path="url(#gf-faceClipS)">
            <path d="M 44,106.5 C 54,108.2 66,113.2 78,118 C 70,137 63,155 60,168 L 52,168 Q 48.5,166 48,163.5 Z" fill="url(#gf-faceGlow)" />
            <path d="M 46,113 L 99,113" stroke="#8a939a" stroke-width="2.8" stroke-linecap="round" opacity="0.9" />
            <path d="M 46.4,118.4 L 99,118.4" stroke="#8a939a" stroke-width="2.8" stroke-linecap="round" opacity="0.9" />
            <path d="M 46.8,123.8 L 99,123.8" stroke="#8a939a" stroke-width="2.8" stroke-linecap="round" opacity="0.9" />
            <path d="M 47.3,129.2 L 99,129.2" stroke="#8a939a" stroke-width="2.8" stroke-linecap="round" opacity="0.9" />
            <path d="M 47.7,134.6 L 99,134.6" stroke="#8a939a" stroke-width="2.8" stroke-linecap="round" opacity="0.9" />
            <path d="M 48.1,140 L 99,140" stroke="#8a939a" stroke-width="2.8" stroke-linecap="round" opacity="0.9" />
            <path d="M 48.5,145.4 L 99,145.4" stroke="#8a939a" stroke-width="2.8" stroke-linecap="round" opacity="0.9" />
            <path d="M 48.9,150.8 L 99,150.8" stroke="#8a939a" stroke-width="2.8" stroke-linecap="round" opacity="0.9" />
            <path d="M 49.4,156.2 L 99,156.2" stroke="#8a939a" stroke-width="2.8" stroke-linecap="round" opacity="0.9" />
            <path d="M 49.8,161.6 L 99,161.6" stroke="#8a939a" stroke-width="2.8" stroke-linecap="round" opacity="0.9" />
          </g>
          <path d="M 37,105 C 53,104.5 84,119 110,131 L 145.24,40.63 A 7.215 7.215 0 0 1 158.68,45.87 L 121.26,141.84 C 122,150 120,159.5 114.5,165 C 111,169 107.5,171 102,171 L 50,171 C 39,170.5 35,167 30,158.5 C 25,150 27.5,124 29.5,114 C 31,108 32.5,105.8 37,105 Z" fill="none" stroke="#0b0c0d" stroke-width="{{ outline }}" stroke-linejoin="round" />
        </g>
      </g>

      <clipPath id="gf-headClipP">
        <path d="M 28,133 L 128,132 L 154.16,64.92 A 7.215 7.215 0 0 1 167.6,70.16 L 139.99,140.97 C 141,149 139,160 135,166 C 132,170 129,171 125,171 L 30,171 C 26,171 23.5,167.5 22,162.5 C 20.5,157 21,140 23,136 C 24.5,133.7 25.5,133.2 28,133 Z" />
      </clipPath>
      <clipPath id="gf-faceClipP">
        <path d="M 33,142.5 L 128,142.5 C 130,142.5 130.6,143.6 130.4,145.4 L 129.2,158.2 C 129,160 128,161 126,161 L 34,161 C 32,161 31,160 30.8,158.2 L 29.6,145.4 C 29.4,143.6 31,142.5 33,142.5 Z" />
      </clipPath>

      <g id="gf-putterArt">
        <g transform="translate(5.55,-15.55)">
          <path d="M 28,133 L 128,132 L 154.16,64.92 A 7.215 7.215 0 0 1 167.6,70.16 L 139.99,140.97 C 141,149 139,160 135,166 C 132,170 129,171 125,171 L 30,171 C 26,171 23.5,167.5 22,162.5 C 20.5,157 21,140 23,136 C 24.5,133.7 25.5,133.2 28,133 Z" fill="url(#gf-steelHead)" stroke="#0b0c0d" stroke-width="{{ outline }}" stroke-linejoin="round" />
          <g clip-path="url(#gf-headClipP)">
            <path d="M 28,133 L 128,132 L 127.4,136.6 L 29.6,137.6 C 26.2,137.8 25.6,133.4 28,133 Z" fill="#ffffff" opacity="0.2" />
            <path d="M 30,171 L 125,171 C 129,171 132,170 135,166 C 131,168.4 127,168 123,168 L 32,168 C 28,168 26,169 24.5,167 C 25.5,169.5 27,171 30,171 Z" fill="#0b0c0d" opacity="0.2" />
            <path d="M 128,132 L 154.16,64.92 A 7.215 7.215 0 0 1 167.6,70.16 L 139.99,140.97 Z" fill="url(#gf-steelShaft)" />
            <path d="M 136.65,109.83 L 151.56,115.64" stroke="#0b0c0d" stroke-width="4" stroke-linecap="round" opacity="0.45" />
            <path d="M 145.24,99.34 L 155.96,71.85" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.42" />
          </g>
          <path d="M 28,133 L 128,132 L 154.16,64.92 A 7.215 7.215 0 0 1 167.6,70.16 L 139.99,140.97 C 141,149 139,160 135,166 C 132,170 129,171 125,171 L 30,171 C 26,171 23.5,167.5 22,162.5 C 20.5,157 21,140 23,136 C 24.5,133.7 25.5,133.2 28,133 Z" fill="none" stroke="#0b0c0d" stroke-width="{{ outline }}" stroke-linejoin="round" />
          <path d="M 33,142.5 L 128,142.5 C 130,142.5 130.6,143.6 130.4,145.4 L 129.2,158.2 C 129,160 128,161 126,161 L 34,161 C 32,161 31,160 30.8,158.2 L 29.6,145.4 C 29.4,143.6 31,142.5 33,142.5 Z" fill="url(#gf-steelFace)" stroke="#0b0c0d" stroke-width="4.4" stroke-linejoin="round" />
          <g clip-path="url(#gf-faceClipP)">
            <path d="M 33,142.5 L 60,142.5 C 50,149 42,156 38,161 L 34,161 C 32,161 31,160 30.8,158.2 Z" fill="url(#gf-faceGlow)" />
            <path d="M 34,148.5 L 125,148.5" stroke="#8a939a" stroke-width="2.6" stroke-linecap="round" opacity="0.85" />
            <path d="M 34,155 L 125,155" stroke="#8a939a" stroke-width="2.6" stroke-linecap="round" opacity="0.85" />
          </g>
        </g>
      </g>
    </defs>`;
