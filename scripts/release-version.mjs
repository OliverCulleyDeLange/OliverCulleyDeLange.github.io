import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const TIME_ZONE = 'Europe/London';
const WORKFLOW_FILE = 'deploy.yml';
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function releaseDate(value) {
  const parts = Object.fromEntries(
    dateFormatter.formatToParts(new Date(value)).map(({ type, value: part }) => [type, part])
  );

  return {
    key: `${parts.year}-${parts.month}-${parts.day}`,
    version: `${Number(parts.year)}.${Number(parts.month)}.${Number(parts.day)}`,
  };
}

export function releaseVersion(currentRun, workflowRuns) {
  const date = releaseDate(currentRun.created_at);
  const runNumbers = new Set(
    workflowRuns
      .filter(run => releaseDate(run.created_at).key === date.key)
      .filter(run => run.run_number <= currentRun.run_number)
      .map(run => run.run_number)
  );

  if (!runNumbers.has(currentRun.run_number)) runNumbers.add(currentRun.run_number);
  return `${date.version}-${runNumbers.size}`;
}

async function github(path, token, apiUrl) {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status} ${response.statusText})`);
  }

  return response.json();
}

async function main() {
  const {
    GITHUB_API_URL = 'https://api.github.com',
    GITHUB_ENV,
    GITHUB_REPOSITORY,
    GITHUB_RUN_ID,
    GITHUB_TOKEN,
  } = process.env;

  if (!GITHUB_ENV || !GITHUB_REPOSITORY || !GITHUB_RUN_ID || !GITHUB_TOKEN) {
    throw new Error('Release version generation must run inside GitHub Actions');
  }

  const currentRun = await github(
    `/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`,
    GITHUB_TOKEN,
    GITHUB_API_URL
  );
  const targetDate = releaseDate(currentRun.created_at).key;
  const workflowRuns = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await github(
      `/repos/${GITHUB_REPOSITORY}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=${PAGE_SIZE}&page=${page}`,
      GITHUB_TOKEN,
      GITHUB_API_URL
    );
    workflowRuns.push(...result.workflow_runs);

    const oldestRun = result.workflow_runs.at(-1);
    const reachedPreviousDate = oldestRun
      ? releaseDate(oldestRun.created_at).key < targetDate
      : true;
    if (result.workflow_runs.length < PAGE_SIZE || reachedPreviousDate) {
      break;
    }

    if (page === MAX_PAGES) {
      throw new Error(`More than ${PAGE_SIZE * MAX_PAGES} workflow runs were created on ${targetDate}`);
    }
  }

  const version = releaseVersion(currentRun, workflowRuns);
  await appendFile(GITHUB_ENV, `PUBLIC_SITE_VERSION=${version}\n`);
  console.log(`Release version: ${version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
