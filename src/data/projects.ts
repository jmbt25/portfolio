export interface ProjectLink {
  label: string;
  href: string;
}

export interface Project {
  name: string;
  year: number;
  oneliner: string;
  stack: string[];
  body: string;
  links?: ProjectLink[];
  privateNote?: string;
}

const handle = 'jmbt25';

export const projects: Project[] = [
  {
    name: 'LaborQuest',
    year: 2026,
    oneliner: 'text-based RPG teaching Filipino workers their labor rights',
    stack: ['python', 'claude api', 'web'],
    body: 'An interactive narrative game where players navigate workplace scenarios — wage disputes, illegal dismissal, working hour violations — and learn how Philippine labor law actually applies. Built end-to-end with Claude Code: branching narrative engine, scenario authoring, deployment. Aimed at workers who would never sit through a legal seminar.',
    links: [
      { label: 'live ↗', href: 'https://laborquest.app' },
      { label: 'src', href: 'https://github.com/Labor-Quest/labor-rights-rpg' },
    ],
  },
  {
    name: 'Mini World',
    year: 2026,
    oneliner: "browser 3D life simulation that notices when you're watching",
    stack: ['javascript', 'three.js', 'simulation', 'web'],
    body: 'A WorldBox-inspired 3D sandbox that runs entirely in the browser — plants spread, herbivores graze, predators hunt, and humans form tribes, build huts, and wage wars. The longer it runs, the more its inhabitants become aware of the camera: a Black Mirror-style emergent layer that drops captioned events as they notice you, leave offerings, and eventually arrange stones into words.',
    links: [
      { label: 'live ↗', href: 'https://jmbt25.github.io' },
      { label: 'src', href: `https://github.com/${handle}/jmbt25.github.io` },
    ],
  },
  {
    name: 'Dota Weakness Report',
    year: 2026,
    oneliner: "analyzes a Dota 2 player's weaknesses against pro player vector comparisons",
    stack: ['python', 'data pipeline', 'vector comparison', 'web'],
    body: 'Pulls match history from the OpenDota API, builds per-hero performance vectors, and compares them against aggregated pro-player baselines to surface specific weaknesses — laning, item timing, map presence — instead of generic stats. Web app with a Python data pipeline behind it.',
    links: [
      { label: 'live ↗', href: 'https://dotaweakness.com' },
      { label: 'src', href: `https://github.com/${handle}/dota-weakness-report` },
    ],
  },
  {
    name: 'dota-deals',
    year: 2026,
    oneliner: 'async Python data pipeline with production-quality error handling',
    stack: ['python', 'asyncio', 'data pipeline'],
    body: "Pipeline that ingests Dota 2 Steam Market data on a schedule, handles partial failures gracefully, and exposes a clean data surface for downstream analysis. Written with the discipline of production code — typed, retries with backoff, structured logging — even though it's a personal project.",
    links: [
      { label: 'live ↗', href: 'https://dotadeals.com' },
      { label: 'src', href: `https://github.com/${handle}/dota-deals` },
    ],
  },
  {
    name: 'ADO MCP Server',
    year: 2026,
    oneliner: 'MCP server connecting Claude to Azure DevOps for natural-language project management',
    stack: ['python', 'mcp', 'azure devops'],
    body: 'A Model Context Protocol server that lets Claude query and act on Azure DevOps work items, pipelines, and repos in plain language. Used internally for faster triage, status summaries, and ticket creation without leaving a chat interface.',
    privateNote: '[private] work / private',
  },
];
