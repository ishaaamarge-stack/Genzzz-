import { NextResponse } from "next/server";

type NewsDataArticle = {
  article_id?: string;
  title?: string;
  link?: string;
  source_name?: string;
  pubDate?: string;
  image_url?: string;
  description?: string;
};

function formatArticle(article: NewsDataArticle) {
  return {
    id: article.article_id || article.link || article.title || crypto.randomUUID(),
    title: article.title || "Untitled story",
    link: article.link || "",
    source: article.source_name || "NewsData",
    publishedAt: article.pubDate || "",
    imageUrl: article.image_url || "",
    description: article.description || "",
  };
}

export async function GET() {
  const apiKey = process.env.NEWSDATA_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "NewsData environment variable is not configured." },
      { status: 503 },
    );
  }

  const url = new URL("https://newsdata.io/api/1/latest");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("country", "us");
  url.searchParams.set("language", "en");
  url.searchParams.set("size", "6");

  let newsResponse: Response;

  try {
    newsResponse = await fetch(url, {
      next: { revalidate: 900 },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach NewsData." },
      { status: 502 },
    );
  }

  if (!newsResponse.ok) {
    const errorText = await newsResponse.text();

    return NextResponse.json(
      {
        error: "NewsData request failed.",
        details: errorText,
      },
      { status: newsResponse.status },
    );
  }

  const data = (await newsResponse.json()) as { results?: NewsDataArticle[] };
  const articles = (data.results || []).slice(0, 6).map(formatArticle);

  return NextResponse.json({ articles });
}
