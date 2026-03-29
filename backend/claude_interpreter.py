"""
Claude-powered brain activation interpreter.

Takes top activated brain regions and generates a plain-English,
slightly unsettling interpretation of what the activation pattern
reveals about the tweet's psychological effect.
"""

import os

import anthropic


INTERPRETER_PROMPT = """You are a neuroscience communicator. Given the top activated brain regions from an fMRI prediction model analyzing a tweet, write ONE sentence (max 20 words) explaining what this activation pattern means for how a person emotionally or cognitively responds to this content. Be specific and slightly unsettling — this is for a tool that exposes manipulation.

Regions: {regions}
Tweet: {tweet_text}

Reply with ONLY the interpretation sentence, no quotes, no explanation."""


async def claude_interpret(
    regions: list[dict],
    tweet_text: str,
    api_key: str = None,
) -> str:
    """
    Generate a plain-English interpretation of brain activation patterns.

    Args:
        regions: List of dicts with 'name', 'activation', 'function' keys
        tweet_text: The original tweet text
        api_key: Anthropic API key (falls back to env var)

    Returns:
        One-sentence interpretation string
    """
    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise ValueError("ANTHROPIC_API_KEY not set")

    client = anthropic.Anthropic(api_key=key)

    region_str = ", ".join(
        f"{r['name']} ({r['activation']:.0%} — {r['function']})"
        for r in regions
    )

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=100,
        messages=[{
            "role": "user",
            "content": INTERPRETER_PROMPT.format(
                regions=region_str,
                tweet_text=tweet_text[:500],
            ),
        }],
    )

    return response.content[0].text.strip().strip('"')
