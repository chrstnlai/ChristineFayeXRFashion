import { handleUpload } from "@vercel/blob/client";

export default async function handler(req: any, res: any) {
  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async () => {
        return { addRandomSuffix: true };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log("Uploaded:", blob.url);
      },
    });

    res.status(200).json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    res.status(400).json({ error: message });
  }
}

