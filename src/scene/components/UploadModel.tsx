import { upload } from "@vercel/blob/client";

type UploadedBlob = { url: string };

export function mountUploadModelForm(host: HTMLElement): () => void {
  const form = document.createElement("form");
  const input = document.createElement("input");
  const button = document.createElement("button");
  const status = document.createElement("p");

  input.type = "file";
  input.accept = ".glb";

  button.type = "submit";
  button.textContent = "Upload .glb";

  status.textContent = "";

  form.append(input, button, status);
  host.replaceChildren(form);

  const onSubmit = async (e: SubmitEvent) => {
    e.preventDefault();

    const file = input.files?.[0];
    if (!file) return;

    button.disabled = true;
    status.textContent = "Uploading...";

    try {
      const handleUploadUrl =
        import.meta.env.VITE_BLOB_UPLOAD_URL?.toString().trim() || "/api/upload";
      const newBlob = (await upload(file.name, file, {
        access: "public",
        handleUploadUrl,
      })) as UploadedBlob;

      status.innerHTML = `Uploaded URL: <a href="${newBlob.url}" target="_blank" rel="noreferrer">${newBlob.url}</a>`;
      console.log("Blob URL:", newBlob.url);
    } catch (error) {
      console.error("Upload failed:", error);
      status.textContent = "Upload failed. Check console.";
    } finally {
      button.disabled = false;
    }
  };

  form.addEventListener("submit", onSubmit);

  return () => {
    form.removeEventListener("submit", onSubmit);
    form.remove();
  };
}