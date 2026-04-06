export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support webcam access.");
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 960 },
        height: { ideal: 720 },
      },
    });

    video.srcObject = stream;
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "true");

    await waitForVideoReady(video);
    return stream;
  } catch (error) {
    throw new Error(describeCameraError(error));
  }
}

export function stopCamera(stream: MediaStream): void {
  stream.getTracks().forEach((track) => {
    track.stop();
  });
}

async function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    await video.play();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onLoadedMetadata = () => {
      cleanup();
      void video.play().then(resolve).catch(reject);
    };

    const onError = () => {
      cleanup();
      reject(new Error("The webcam stream became unavailable before playback started."));
    };

    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("error", onError);
    };

    video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function describeCameraError(error: unknown): string {
  if (!(error instanceof DOMException)) {
    return error instanceof Error ? error.message : "Unable to start the webcam.";
  }

  switch (error.name) {
    case "NotAllowedError":
      return "Camera access was blocked. Allow webcam permission and try again.";
    case "NotFoundError":
      return "No webcam was found on this device.";
    case "NotReadableError":
      return "The webcam is already in use by another app.";
    case "OverconstrainedError":
      return "The requested camera settings are not supported on this device.";
    default:
      return error.message || "Unable to start the webcam.";
  }
}
