import { NextResponse } from "next/server";

type VideoResponse = {
  id?: string;
  status?: string;
  url?: string;
  video_url?: string;
  output_url?: string;
  b64_json?: string;
  data?: Array<{
    url?: string;
    video_url?: string;
    output_url?: string;
    b64_json?: string;
  }>;
  error?: unknown;
};

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 40;

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getVideoUrl(data: VideoResponse) {
  const firstItem = data.data?.[0];
  const url =
    data.url ||
    data.video_url ||
    data.output_url ||
    firstItem?.url ||
    firstItem?.video_url ||
    firstItem?.output_url;

  if (url) {
    return url;
  }

  const b64 = data.b64_json || firstItem?.b64_json;

  return b64 ? `data:video/mp4;base64,${b64}` : "";
}

function isTerminalFailure(status?: string) {
  return ["failed", "cancelled", "canceled", "expired"].includes(
    String(status || "").toLowerCase(),
  );
}

function isComplete(status?: string) {
  return ["completed", "complete", "succeeded", "success"].includes(
    String(status || "").toLowerCase(),
  );
}

async function fetchVideoContent(endpoint: string, id: string, apiKey: string) {
  const response = await fetch(`${endpoint}/${id}/content`, {
    headers: {
      "api-key": apiKey,
    },
  });

  if (!response.ok) {
    return "";
  }

  const contentType = response.headers.get("content-type") || "video/mp4";
  const buffer = Buffer.from(await response.arrayBuffer());

  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

export async function POST(request: Request) {
  const endpoint = process.env.AZURE_OPENAI_VIDEO_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_VIDEO_API_KEY;
  const model = process.env.AZURE_OPENAI_VIDEO_DEPLOYMENT_NAME || "sora-2";

  if (!endpoint || !apiKey) {
    return NextResponse.json(
      { error: "Azure OpenAI video environment variables are not configured." },
      { status: 503 },
    );
  }

  let body: { prompt?: string };

  try {
    body = (await request.json()) as { prompt?: string };
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const prompt = body.prompt?.trim();

  if (!prompt) {
    return NextResponse.json(
      { error: "A video prompt is required." },
      { status: 400 },
    );
  }

  let createResponse: Response;

  try {
    createResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        model,
        prompt,
        seconds: "4",
        size: "1280x720",
      }),
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach Azure OpenAI video generation." },
      { status: 502 },
    );
  }

  if (!createResponse.ok) {
    const errorText = await createResponse.text();

    return NextResponse.json(
      {
        error: "Azure OpenAI video request failed.",
        details: errorText,
      },
      { status: createResponse.status },
    );
  }

  let data = (await createResponse.json()) as VideoResponse;
  let videoUrl = getVideoUrl(data);

  if (videoUrl) {
    return NextResponse.json({ videoUrl, prompt });
  }

  const id = data.id;

  if (!id) {
    return NextResponse.json(
      { error: "Azure OpenAI did not return a video or job id." },
      { status: 502 },
    );
  }

  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    await sleep(POLL_INTERVAL_MS);

    const statusResponse = await fetch(`${endpoint}/${id}`, {
      headers: {
        "api-key": apiKey,
      },
    });

    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();

      return NextResponse.json(
        {
          error: "Azure OpenAI video status request failed.",
          details: errorText,
        },
        { status: statusResponse.status },
      );
    }

    data = (await statusResponse.json()) as VideoResponse;
    videoUrl = getVideoUrl(data);

    if (videoUrl) {
      return NextResponse.json({ videoUrl, prompt });
    }

    if (isComplete(data.status)) {
      const contentUrl = await fetchVideoContent(endpoint, id, apiKey);

      if (contentUrl) {
        return NextResponse.json({ videoUrl: contentUrl, prompt });
      }
    }

    if (isTerminalFailure(data.status)) {
      return NextResponse.json(
        { error: "Azure OpenAI video generation failed.", details: data.error },
        { status: 502 },
      );
    }
  }

  return NextResponse.json(
    { error: "Video generation is still processing. Try again with a shorter prompt." },
    { status: 504 },
  );
}
