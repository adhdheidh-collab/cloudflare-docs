import { createAppAuth } from "@octokit/auth-app";

const REPO = "cloudflare/cloudflare-docs";

export interface PullRequestFile {
	filename: string;
	status: string;
	additions: number;
	deletions: number;
	changes: number;
	patch?: string;
	/**
	 * The previous filename for renamed files (status === "renamed").
	 * Present in the GitHub API response; absent for all other statuses.
	 * Use this — not filename — when computing the old path of a rename.
	 */
	previous_filename?: string;
}

export interface GitHubUser {
	login: string;
	type?: string;
}

export interface GitHubIssue {
	number: number;
	title: string;
	body: string | null;
	state: string;
	html_url: string;
	user: GitHubUser | null;
	author_association: string;
	labels: Array<{ name: string }>;
}

export interface GitHubPullRequest {
	number: number;
	title: string;
	body: string | null;
	state: string;
	html_url: string;
	user: GitHubUser | null;
	author_association: string;
	draft: boolean;
	labels: { name: string }[];
	base: { ref: string; sha: string };
	head: { ref: string; sha: string };
}

export async function getInstallationToken(
	env: Record<string, string>,
): Promise<string> {
	const auth = createAppAuth({
		appId: env.DOCS_FLUE_GITHUB_APP_ID,
		privateKey: env.DOCS_FLUE_GITHUB_APP_PRIVATE_KEY,
		installationId: Number(env.DOCS_FLUE_GITHUB_INSTALLATION_ID),
	});

	const { token } = await auth({ type: "installation" });
	return token;
}

function apiHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"Content-Type": "application/json",
		"User-Agent": "cloudflare-docs-agents",
	};
}

export async function closeIssue(
	token: string,
	issueNumber: number,
): Promise<void> {
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/issues/${issueNumber}`,
		{
			method: "PATCH",
			headers: apiHeaders(token),
			body: JSON.stringify({ state: "closed", state_reason: "not_planned" }),
		},
	);
	if (!res.ok) {
		throw new Error(
			`Failed to close issue ${issueNumber} (HTTP ${res.status}): ${await res.text()}`,
		);
	}
}

export async function postComment(
	token: string,
	issueNumber: number,
	body: string,
): Promise<void> {
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/issues/${issueNumber}/comments`,
		{
			method: "POST",
			headers: apiHeaders(token),
			body: JSON.stringify({ body }),
		},
	);
	if (!res.ok) {
		throw new Error(
			`Failed to post comment on ${issueNumber} (HTTP ${res.status}): ${await res.text()}`,
		);
	}
}

export async function getIssue(
	token: string,
	issueNumber: number,
): Promise<GitHubIssue> {
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/issues/${issueNumber}`,
		{
			headers: apiHeaders(token),
		},
	);
	if (!res.ok) {
		throw new Error(
			`Failed to get issue ${issueNumber} (HTTP ${res.status}): ${await res.text()}`,
		);
	}
	return (await res.json()) as GitHubIssue;
}

export async function getPullRequest(
	token: string,
	pullNumber: number,
): Promise<GitHubPullRequest> {
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/pulls/${pullNumber}`,
		{
			headers: apiHeaders(token),
		},
	);
	if (!res.ok) {
		throw new Error(
			`Failed to get PR ${pullNumber} (HTTP ${res.status}): ${await res.text()}`,
		);
	}
	return (await res.json()) as GitHubPullRequest;
}

/**
 * Fetch the decoded text content of a repo file at a given ref via the
 * GitHub contents API. Returns null when the file is missing (404) or not
 * base64 text; throws on other non-2xx responses (rate limit, auth, 5xx) so
 * callers can distinguish "absent" from "failed to load". Used to load
 * repo-level context (e.g. the root AGENTS.md) into agents.
 */
export async function getRepoFileContent(
	token: string,
	path: string,
	ref: string,
): Promise<string | null> {
	// Encode each path segment but preserve the slashes the contents API needs.
	const encodedPath = path.split("/").map(encodeURIComponent).join("/");
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
		{ headers: apiHeaders(token) },
	);
	if (res.status === 404) return null;
	if (!res.ok) {
		throw new Error(
			`Failed to get repo file ${path}@${ref} (HTTP ${res.status}): ${await res.text()}`,
		);
	}
	const data = (await res.json()) as {
		encoding?: string;
		content?: string;
	};
	if (data.encoding !== "base64" || typeof data.content !== "string") {
		return null;
	}
	// atob yields a Latin-1 byte string; decode those bytes as UTF-8 so
	// non-ASCII content (e.g. em dashes in AGENTS.md) is not mojibake.
	const binary = atob(data.content.replace(/\n/g, ""));
	const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

export async function getPullRequestFiles(
	token: string,
	pullNumber: number,
): Promise<PullRequestFile[]> {
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/pulls/${pullNumber}/files?per_page=100`,
		{
			headers: apiHeaders(token),
		},
	);
	if (!res.ok) {
		throw new Error(
			`Failed to get PR files for ${pullNumber} (HTTP ${res.status}): ${await res.text()}`,
		);
	}
	return (await res.json()) as PullRequestFile[];
}

export async function addLabels(
	token: string,
	issueNumber: number,
	labels: string[],
): Promise<void> {
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/issues/${issueNumber}/labels`,
		{
			method: "POST",
			headers: apiHeaders(token),
			body: JSON.stringify({ labels }),
		},
	);
	if (!res.ok) {
		throw new Error(
			`Failed to add labels to ${issueNumber} (HTTP ${res.status}): ${await res.text()}`,
		);
	}
}

export interface GitHubIssueComment {
	id: number;
	body: string | null;
	created_at: string;
	updated_at: string;
	user: GitHubUser | null;
}

export async function getIssueComments(
	token: string,
	issueNumber: number,
): Promise<GitHubIssueComment[]> {
	// Fetch newest comments first so recent human replies aren't missed on
	// busy PRs that exceed the 100-comment page limit.
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/issues/${issueNumber}/comments?per_page=100&direction=desc`,
		{ headers: apiHeaders(token) },
	);
	if (!res.ok) {
		throw new Error(
			`Failed to get comments for ${issueNumber} (HTTP ${res.status}): ${await res.text()}`,
		);
	}
	// Reverse so callers get oldest-first order (consistent with previous behavior
	// and safe for findLast() / botComment detection).
	const comments = (await res.json()) as GitHubIssueComment[];
	return comments.reverse();
}

export async function updateIssueComment(
	token: string,
	commentId: number,
	body: string,
): Promise<void> {
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/issues/comments/${commentId}`,
		{
			method: "PATCH",
			headers: apiHeaders(token),
			body: JSON.stringify({ body }),
		},
	);
	if (!res.ok) {
		throw new Error(
			`Failed to update comment ${commentId} (HTTP ${res.status}): ${await res.text()}`,
		);
	}
}

export async function comparePullRequestHeads(
	token: string,
	base: string,
	head: string,
): Promise<{ files: PullRequestFile[] } | null> {
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/compare/${base}...${head}`,
		{ headers: apiHeaders(token) },
	);
	if (res.status === 404) return null;
	if (!res.ok) {
		throw new Error(
			`Failed to compare ${base}...${head} (HTTP ${res.status}): ${await res.text()}`,
		);
	}
	const data = (await res.json()) as { files?: PullRequestFile[] };
	return { files: data.files ?? [] };
}

export async function addReactionToComment(
	token: string,
	commentId: number,
	reaction:
		| "+1"
		| "-1"
		| "laugh"
		| "confused"
		| "heart"
		| "hooray"
		| "rocket"
		| "eyes",
): Promise<number | null> {
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/issues/comments/${commentId}/reactions`,
		{
			method: "POST",
			headers: apiHeaders(token),
			body: JSON.stringify({ content: reaction }),
		},
	);
	if (res.status === 422) return null; // already exists
	if (!res.ok) {
		throw new Error(
			`Failed to add reaction to comment ${commentId} (HTTP ${res.status}): ${await res.text()}`,
		);
	}
	const data = (await res.json()) as { id: number };
	return data.id;
}

export async function removeReactionFromComment(
	token: string,
	commentId: number,
	reactionId: number,
): Promise<void> {
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/issues/comments/${commentId}/reactions/${reactionId}`,
		{
			method: "DELETE",
			headers: apiHeaders(token),
		},
	);
	// 204 = success, 404 = already gone — both are fine
	if (!res.ok && res.status !== 404) {
		throw new Error(
			`Failed to remove reaction ${reactionId} from comment ${commentId} (HTTP ${res.status}): ${await res.text()}`,
		);
	}
}

/**
 * Check whether `username` is a codeowner in .github/CODEOWNERS on the
 * production branch. Always reads from the production branch so ad-hoc
 * CODEOWNERS changes on feature branches don't grant access.
 *
 * @param installationToken - GitHub App installation token (for repo contents API)
 * @param orgToken - Personal/org token with read:org scope (for team membership API)
 * @param username - GitHub username to check
 */
export async function isCodeOwner(
	installationToken: string,
	orgToken: string,
	username: string,
): Promise<boolean> {
	// Fetch CODEOWNERS from the production branch via the GitHub contents API
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/contents/.github/CODEOWNERS?ref=production`,
		{ headers: apiHeaders(installationToken) },
	);
	if (!res.ok) return false;

	const data = (await res.json()) as { content?: string; encoding?: string };
	if (!data.content || data.encoding !== "base64") return false;

	const content = atob(data.content.replace(/\n/g, ""));

	// Extract all @mentions from non-comment lines
	const mentions = new Set<string>();
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		for (const match of trimmed.matchAll(/@([\w.-]+\/[\w.-]+|[\w.-]+)/g)) {
			mentions.add(match[1]);
		}
	}

	for (const mention of mentions) {
		if (mention.includes("/")) {
			// Team mention: @org/team — check membership using org token (needs read:org)
			const [org, team] = mention.split("/");
			const memberRes = await fetch(
				`https://api.github.com/orgs/${org}/teams/${team}/memberships/${username}`,
				{ headers: apiHeaders(orgToken) },
			);
			if (memberRes.ok) return true;
		} else {
			// Direct user mention
			if (mention.toLowerCase() === username.toLowerCase()) return true;
		}
	}

	return false;
}

// ── Rebase / Git Data API ─────────────────────────────────────────────────────

export interface UpdateBranchResult {
	ok: boolean;
	/** Present when ok=false (conflict or other API error message). */
	message?: string;
}

/**
 * Update a pull request's branch against its base using the GitHub API.
 * Pass update_method "rebase" to attempt a rebase rather than a merge commit.
 * Returns { ok: false, message } on 422 (conflict) instead of throwing, so
 * callers can inspect the failure without a try/catch.
 */
export async function updatePullRequestBranch(
	token: string,
	pullNumber: number,
	updateMethod: "merge" | "rebase",
): Promise<UpdateBranchResult> {
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/pulls/${pullNumber}/update-branch`,
		{
			method: "PUT",
			headers: apiHeaders(token),
			body: JSON.stringify({ update_method: updateMethod }),
		},
	);
	if (res.ok) return { ok: true };
	const text = await res.text();
	let message = text;
	try {
		const json = JSON.parse(text) as { message?: string };
		if (json.message) message = json.message;
	} catch {
		// leave message as raw text
	}
	if (res.status === 422) return { ok: false, message };
	throw new Error(
		`Failed to update branch for PR #${pullNumber} (HTTP ${res.status}): ${message}`,
	);
}

export interface GitRef {
	sha: string;
	ref: string;
}

export async function getRef(token: string, branch: string): Promise<GitRef> {
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/git/refs/heads/${branch}`,
		{ headers: apiHeaders(token) },
	);
	if (!res.ok) {
		throw new Error(
			`Failed to get ref heads/${branch} (HTTP ${res.status}): ${await res.text()}`,
		);
	}
	const data = (await res.json()) as { object: { sha: string }; ref: string };
	return { sha: data.object.sha, ref: data.ref };
}

export interface GitCommit {
	sha: string;
	treeSha: string;
	parentShas: string[];
	message: string;
}

export async function getGitCommit(
	token: string,
	sha: string,
): Promise<GitCommit> {
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/git/commits/${sha}`,
		{ headers: apiHeaders(token) },
	);
	if (!res.ok) {
		throw new Error(
			`Failed to get commit ${sha} (HTTP ${res.status}): ${await res.text()}`,
		);
	}
	const data = (await res.json()) as {
		sha: string;
		tree: { sha: string };
		parents: { sha: string }[];
		message: string;
	};
	return {
		sha: data.sha,
		treeSha: data.tree.sha,
		parentShas: data.parents.map((p) => p.sha),
		message: data.message,
	};
}

export interface GitTreeEntry {
	path: string;
	mode: string;
	type: string;
	sha: string | null;
	size?: number;
}

export async function getTree(
	token: string,
	treeSha: string,
): Promise<GitTreeEntry[]> {
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/git/trees/${treeSha}?recursive=1`,
		{ headers: apiHeaders(token) },
	);
	if (!res.ok) {
		throw new Error(
			`Failed to get tree ${treeSha} (HTTP ${res.status}): ${await res.text()}`,
		);
	}
	const data = (await res.json()) as { tree: GitTreeEntry[] };
	return data.tree;
}

/**
 * Fetch the decoded text content of a git blob by its SHA.
 * Returns null if the blob is not base64-encoded text.
 */
export async function getGitBlob(
	token: string,
	blobSha: string,
): Promise<string | null> {
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/git/blobs/${blobSha}`,
		{ headers: apiHeaders(token) },
	);
	if (!res.ok) {
		throw new Error(
			`Failed to get blob ${blobSha} (HTTP ${res.status}): ${await res.text()}`,
		);
	}
	const data = (await res.json()) as { encoding?: string; content?: string };
	if (data.encoding !== "base64" || typeof data.content !== "string")
		return null;
	const binary = atob(data.content.replace(/\n/g, ""));
	const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

/**
 * Create a new git blob from text content.
 * Returns the new blob SHA.
 */
export async function createBlob(
	token: string,
	content: string,
): Promise<string> {
	const res = await fetch(`https://api.github.com/repos/${REPO}/git/blobs`, {
		method: "POST",
		headers: apiHeaders(token),
		body: JSON.stringify({ content, encoding: "utf-8" }),
	});
	if (!res.ok) {
		throw new Error(
			`Failed to create blob (HTTP ${res.status}): ${await res.text()}`,
		);
	}
	const data = (await res.json()) as { sha: string };
	return data.sha;
}

export interface TreeUpdate {
	path: string;
	/** "100644" for regular file */
	mode: "100644" | "100755" | "040000" | "160000" | "120000";
	type: "blob" | "tree" | "commit";
	/** The blob SHA, or null to delete the file */
	sha: string | null;
}

/**
 * Create a new git tree by applying updates on top of a base tree.
 * Pass sha=null in a TreeUpdate to delete that path.
 * Returns the new tree SHA.
 */
export async function createTree(
	token: string,
	baseTreeSha: string,
	updates: TreeUpdate[],
): Promise<string> {
	const res = await fetch(`https://api.github.com/repos/${REPO}/git/trees`, {
		method: "POST",
		headers: apiHeaders(token),
		body: JSON.stringify({ base_tree: baseTreeSha, tree: updates }),
	});
	if (!res.ok) {
		throw new Error(
			`Failed to create tree (HTTP ${res.status}): ${await res.text()}`,
		);
	}
	const data = (await res.json()) as { sha: string };
	return data.sha;
}

/**
 * Create a new git commit.
 * Returns the new commit SHA.
 */
export async function createGitCommit(
	token: string,
	message: string,
	treeSha: string,
	parentShas: string[],
): Promise<string> {
	const res = await fetch(`https://api.github.com/repos/${REPO}/git/commits`, {
		method: "POST",
		headers: apiHeaders(token),
		body: JSON.stringify({ message, tree: treeSha, parents: parentShas }),
	});
	if (!res.ok) {
		throw new Error(
			`Failed to create commit (HTTP ${res.status}): ${await res.text()}`,
		);
	}
	const data = (await res.json()) as { sha: string };
	return data.sha;
}

/**
 * Force-update a branch ref to point to a new commit SHA.
 */
export async function updateRef(
	token: string,
	branch: string,
	sha: string,
): Promise<void> {
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/git/refs/heads/${branch}`,
		{
			method: "PATCH",
			headers: apiHeaders(token),
			body: JSON.stringify({ sha, force: true }),
		},
	);
	if (!res.ok) {
		throw new Error(
			`Failed to update ref heads/${branch} to ${sha} (HTTP ${res.status}): ${await res.text()}`,
		);
	}
}

/**
 * Get the commits between a base and head ref (non-inclusive of base).
 * Used to find the commits on a PR branch since its merge base.
 */
export interface CompareCommit {
	sha: string;
	message: string;
}

export async function compareCommits(
	token: string,
	base: string,
	head: string,
): Promise<{ mergeBaseSha: string; commits: CompareCommit[] }> {
	const res = await fetch(
		`https://api.github.com/repos/${REPO}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
		{ headers: apiHeaders(token) },
	);
	if (!res.ok) {
		throw new Error(
			`Failed to compare ${base}...${head} (HTTP ${res.status}): ${await res.text()}`,
		);
	}
	const data = (await res.json()) as {
		merge_base_commit: { sha: string };
		commits: { sha: string; commit: { message: string } }[];
	};
	return {
		mergeBaseSha: data.merge_base_commit.sha,
		commits: data.commits.map((c) => ({
			sha: c.sha,
			message: c.commit.message,
		})),
	};
}

export async function verifyGitHubSignature(
	body: string,
	signature: string,
	secret: string,
): Promise<boolean> {
	if (!signature.startsWith("sha256=")) return false;

	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
	const expected =
		"sha256=" +
		Array.from(new Uint8Array(mac))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");

	if (expected.length !== signature.length) return false;
	let diff = 0;
	for (let i = 0; i < expected.length; i++) {
		diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
	}
	return diff === 0;
}
