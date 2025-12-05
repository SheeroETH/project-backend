import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Replicate from 'replicate';

dotenv.config();

const app = express();
const port = 3000;

// Increase limit to accept images
app.use(express.json({ limit: '50mb' }));
app.use(cors());

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Simple in-memory rate limiter
const rateLimitMap = new Map();
const MAX_DAILY_GENERATIONS = 4;

const rateLimiter = (req, res, next) => {
  // Get IP address
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const today = new Date().toISOString().split('T')[0];

  const userRecord = rateLimitMap.get(ip);

  if (userRecord && userRecord.date === today) {
    if (userRecord.count >= MAX_DAILY_GENERATIONS) {
      return res.status(429).json({ error: 'Daily limit reached. Please come back tomorrow!' });
    }
    userRecord.count++;
  } else {
    // New user or new day
    rateLimitMap.set(ip, { date: today, count: 1 });
  }

  next();
};

app.post('/api/generate', rateLimiter, async (req, res) => {
  try {
    const { prompt, image } = req.body;

    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    if (!image) return res.status(400).json({ error: 'Image is required' });

    console.log('Generating with Google Nano Banana Pro (Gemini)...');
    console.log('Type of input sending to Replicate:', Array.isArray([image]) ? 'ARRAY (Correct)' : 'STRING (Error)');

    // Manual fetch to ensure control over the input format
    const model = "google/nano-banana-pro";
    const response = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          image_input: [image], // Explicitly sending an array
          prompt: prompt,
          output_format: "jpg"
        }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('SERVER ERROR DETAIL:', error);
      return res.status(response.status).json({ error: 'Failed to generate image', details: error });
    }

    let prediction = await response.json();
    console.log("Prediction created:", prediction.id);

    // Poll for result
    while (prediction.status !== "succeeded" && prediction.status !== "failed" && prediction.status !== "canceled") {
      await new Promise(r => setTimeout(r, 1000));
      const statusRes = await fetch(prediction.urls.get, {
        headers: {
          "Authorization": `Bearer ${process.env.REPLICATE_API_TOKEN}`,
        }
      });
      prediction = await statusRes.json();
    }

    if (prediction.status !== "succeeded") {
      console.error("Prediction failed:", prediction.error);
      return res.status(500).json({ error: "Prediction failed", details: prediction.error });
    }

    const output = prediction.output;
    console.log('Generation complete:', output);

    // Handle return (URL or array)
    const resultUrl = Array.isArray(output) ? output[0] : output;
    res.json({ result: resultUrl });

  } catch (error) {
    console.error('SERVER ERROR DETAIL:', error);
    res.status(500).json({ error: 'Failed to generate image', details: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});