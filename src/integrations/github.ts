interface CreateIssueArgs {
  title: string;
  body: string;
  labels?: string[];
}

export async function createGitHubIssue(args: CreateIssueArgs): Promise<{
  number: number;
  url: string;
  title: string;
}> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO; // "owner/repo"

  if (!token) {
    throw new Error('Missing GITHUB_TOKEN env var (GitHub PAT with repo scope)');
  }
  if (!repo || !repo.includes('/')) {
    throw new Error('Missing/invalid GITHUB_REPO env var (expected "owner/repo")');
  }

  const resp = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'cold-agent',
    },
    body: JSON.stringify({
      title: args.title,
      body: args.body,
      labels: args.labels,
    }),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`GitHub API error (${resp.status}): ${text.slice(0, 500)}`);
  }

  const data = JSON.parse(text);
  return {
    number: data.number,
    url: data.html_url,
    title: data.title,
  };
}

