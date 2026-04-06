# XR Fashion Final - Christine Lai
# Maison Margela

Minimal WebGL MVP that renders a 3D scene with `Three.js` and shifts the camera based on webcam-tracked head movement from MediaPipe Face Landmarker.

## Requirements

- Node.js 24+
- A modern browser with WebGL 2
- Webcam access on `localhost`

## Scripts

- `npm install`: install dependencies and sync the local MediaPipe WASM files into `public/vendor/mediapipe`
- `npm run dev`: start the local development server at [http://127.0.0.1:4173](http://127.0.0.1:4173)
- `npm test`: run the unit tests for calibration and motion-mapping logic
- `npm run build`: run TypeScript checks and create a production build
- `npm run check`: run tests and the production build together

## How To Try It

1. Run `npm install`
2. Run `npm run dev`
3. Open [http://127.0.0.1:4173](http://127.0.0.1:4173)
4. Click `Start Camera`
5. Hold still briefly so the neutral pose can calibrate
6. Move your head gently left and right to shift the camera

## Notes

- The app mirrors the small preview for comfort, but tracking uses the raw camera feed.
- MediaPipe WASM files are served locally. The face landmark model itself is fetched from Google's hosted model URL when tracking starts.
# ChristineFayeXRFashion
