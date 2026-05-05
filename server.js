import express from "express";
import { handleUpload } from "@vercel/blob/client";

const app = express();
app.use(express.json());

app.post("/api/upload", async (req, res) => {
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

    res.json(jsonResponse);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.listen(3001, () => {
  console.log("Server running on http://localhost:3001");
});