# COMMONS-TOS: AI Tool Usage Policies for Grove Commons Contributions

> **Status:** Research snapshot — June 2026
> **Scope:** Covers the Grove Commons model (ADR-0013): a contributor uses their own AI coding tool to draft a patch, reviews it, and opens a GitHub PR under their own identity. A maintainer merges. CI gates apply. This is *attended, human-in-the-loop use*.
> **Critical caveat:** AI provider terms of service change frequently and without notice. Every section below includes the source URL and the date that source was last verified. **Re-verify all entries before relying on them**, especially before a public launch, a funding event, or any commercial arrangement.

---

## How to read the verdicts

Each tool gets a per-dimension rating and an overall verdict for the specific Grove Commons model:

| Symbol | Meaning |
|--------|---------|
| LIKELY OK | Current terms are compatible; normal legal hygiene applies |
| NEEDS CARE | Compatible on the face of the terms but has a meaningful ambiguity, a known exception, or a dependency on plan tier |
| BLOCKED | Explicit prohibition or high legal risk; do not proceed without legal counsel or a plan change |

The verdicts are based on the *attended, user-opens-the-PR* model. They are **not** legal advice.

---

## 1. Anthropic — Claude / Claude Code

### Sources consulted
- [Anthropic Consumer Terms of Service](https://www.anthropic.com/legal/consumer-terms) — effective January 31, 2026; retrieved June 2026
- [Anthropic Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms) — retrieved June 2026
- [Claude Code Legal and Compliance](https://code.claude.com/docs/en/legal-and-compliance) — retrieved June 2026
- [Anthropic Expanded Legal Protections announcement](https://www.anthropic.com/news/expanded-legal-protections-api-improvements) — 2024
- [Anthropic Usage Policy Update](https://www.anthropic.com/news/usage-policy-update)
- Secondary analysis: [terms.law/ai-output-rights/anthropic/](https://terms.law/ai-output-rights/anthropic/) — March 2026 update

### (a) Using Claude to help write code you contribute to open source

**LIKELY OK.**

Both the Consumer and Commercial terms assign all right, title, and interest in Outputs to the user: *"Subject to your compliance with our Terms, we assign to you all of our right, title, and interest—if any—in Outputs."* (Consumer Terms). The Commercial Terms mirror this with explicit IP indemnification for paid use.

No provision in the current terms restricts using Claude-generated code in open-source contributions or OSS-licensed repositories. The Claude Code legal docs confirm that Claude Code usage is subject to the standard terms and acceptable-use policy; there is no carve-out barring OSS work.

**Caveat:** "Assign to you" is a contractual grant, not a copyright in the traditional sense. Post-*Thaler v. Perlmutter* (SCOTUS cert denied February 2026), US courts have settled that purely AI-generated content lacks the human authorship required for copyright. The practical result for the Grove Commons model is that the *human* contributor's review, editing, and judgment over the patch is what confers any copyright the contributor holds. This is compatible with MIT licensing so long as the contribution is meaningfully human-directed.

### (b) Automated / unattended generation vs. attended use

**NEEDS CARE (for attended Claude Code use) — BLOCKED for OAuth-based unattended automation.**

The Consumer Terms forbid: *"to access the Services through automated or non-human means, whether through a bot, script, or otherwise"* except via an Anthropic API key or where explicitly permitted.

As of January 2026, Anthropic enforces this technically: OAuth tokens (the login used by Free/Pro/Max subscribers) are locked to Claude Code and other official Anthropic apps; they cannot be routed through third-party harnesses. Starting June 15, 2026, Agent SDK and `claude -p` usage on subscription plans draw from a separate monthly Agent SDK credit pool.

**For the Grove Commons model:** A contributor personally running Claude Code on their own machine, reviewing the output, and opening a PR is attended use. This is what the tool is designed for. There is no conflict with current terms.

**Risk zone:** If Grove ever built automation that called Claude on behalf of contributors without their direct involvement (e.g., a bot that auto-generates patches), that would require API-key billing and explicit operator-tier permissions.

### (c) Ownership / licensing of AI-generated output — can the user license it MIT?

**LIKELY OK, with an important nuance.**

Anthropic assigns whatever rights it holds to the user. The user can apply any license they choose to code they commit—including MIT. The practical nuance: under current US copyright law, purely AI-generated text has no copyright owner. A contributor who prompts Claude and pastes the result without modification cannot claim copyright on that text.

For MIT licensing to be legally meaningful, the contributor needs to be the author of a *work with sufficient human authorship*: directing the solution approach, reviewing and editing the code, making judgments about correctness, integrating it with the surrounding codebase. This is exactly what the Grove Commons attended model requires. Well-documented human review and editing is both good practice and the correct legal posture.

**For the Commercial Terms (API / Team / Enterprise users):** IP indemnification applies, covering third-party IP infringement claims against the user for authorized use of the outputs. This is a stronger protection but is plan-tier-dependent.

### (d) Restrictions on pooling output for a collective / commercial service

**NEEDS CARE.**

The terms prohibit using Claude outputs *"to develop any products or services that compete with our Services, including to develop or train any artificial intelligence or machine learning algorithms or models."*

Grove is a *workflow layer over AI coding*, not an AI model and not a competitor to Claude. However, if Grove's Commons pooled AI-generated contributions to build a training dataset or to improve a model, that would be prohibited. The contribution workflow itself (humans drafting patches with AI assistance, reviewed by maintainers) does not trigger this clause.

There is no explicit restriction on an open-source project receiving MIT-licensed code that was written with Claude assistance, even if that project has commercial elements.

---

## 2. OpenAI — ChatGPT / Codex

### Sources consulted
- [OpenAI Terms of Use (rest of world)](https://openai.com/policies/row-terms-of-use/) — effective January 2026; access attempt returned 403, content sourced from secondary analysis
- [OpenAI Services Agreement (enterprise)](https://openai.com/policies/services-agreement/) — reviewed via search result summary
- [OpenAI Codex product page](https://openai.com/codex/)
- Secondary analysis: [terms.law — navigating AI platform policies (March 2026)](https://www.terms.law/2025/04/09/navigating-ai-platform-policies-who-owns-ai-generated-content/) and [glbgpt.com ChatGPT commercial use 2026](https://www.glbgpt.com/hub/chatgpt-commercial-use-2026/)
- [OpenAI community thread: Codex for Open Source 2026](https://community.openai.com/t/codex-for-open-source-2026/1376418)

**Note:** The OpenAI.com policy pages returned HTTP 403 to automated fetching. The quotes below are drawn from secondary legal-analysis sources that cite the terms directly; they should be independently verified.

### (a) Using ChatGPT / Codex to help write code you contribute to open source

**LIKELY OK.**

OpenAI's Terms of Use assign output to the user: *"As between you and OpenAI, and to the extent permitted by applicable law, you own the Output."* and *"OpenAI hereby assigns to you all of OpenAI's right, title, and interest in and to Output."* No explicit restriction on using output in OSS contributions exists in the current consumer terms.

OpenAI has specifically launched a "Codex for Open Source" program (announced 2026) offering credits and Pro access for OSS maintainers using Codex in PR review and release workflows — a strong signal of positive intent toward open-source use.

**Caveat:** The terms note that output generated by code-generation features *"may be subject to third-party licenses, including open source licenses."* Users are responsible for determining whether suggestions match licensed code. Running the Codex duplicate-detection / citation features where available is prudent.

### (b) Automated / unattended generation vs. attended use

**NEEDS CARE.**

The Terms of Use prohibit *"automatically or programmatically extract[ing] data or Output"* and *"represent[ing] that Output was human-generated when it was not."*

For the Grove Commons model (attended use, human opens the PR), there is no conflict. The prohibition targets mass scraping and automated pipeline use without disclosure, not ordinary developer use.

OpenAI has introduced rate limits and plan tiers specifically around Codex agent mode (as of April 2026 rate-limiting updates). Heavy automated use of Codex on lower-tier plans risks hitting quotas. For human-assisted, one-PR-at-a-time contribution, this is not a practical concern.

### (c) Ownership / licensing of AI-generated output — can the user license it MIT?

**LIKELY OK.**

Same copyright nuance as Anthropic applies. OpenAI assigns its interest to the user; the user can apply MIT. Human authorship remains the deciding factor for whether that copyright is meaningful. Attended, reviewed contribution is the right posture.

Enterprise (Services Agreement) users get an additional guarantee: *"OpenAI will not use Customer Content to develop or improve the Services, unless Customer explicitly agrees."*

### (d) Restrictions on pooling output for a collective / commercial service

**NEEDS CARE.**

The Terms of Use prohibit using output *"to develop models that compete with OpenAI."* The same carve-out applies as for Anthropic: collecting AI-assisted MIT patches for a non-AI open-source project is not prohibited. Building a training corpus or an AI model from those patches would be.

No explicit restriction on a project with commercial elements receiving code that originated from ChatGPT/Codex.

---

## 3. GitHub Copilot

### Sources consulted
- [GitHub Generative AI Services Terms — March 5, 2026 (PDF)](https://assets.ctfassets.net/8aevphvgewt8/5M04RGwkRts1Pj4vUIWGlp/0bd045a49674bcfe2fa0b9b692998e71/GitHub_Generative_AI_Services_Terms_-_2026_03_05_-_FINAL.pdf) — text extracted directly; **primary source**
- [GitHub Copilot Product Specific Terms — March 5, 2026 (PDF)](https://assets.ctfassets.net/8aevphvgewt8/1Y0gmEkMnAs8W6N4ai2R1g/694c0ae359902dc0700454333ad15c44/GitHub_Copilot_Product_Specific_Terms_-_2026_03_05_-_FINAL.pdf) — archived; replaced by above for new subscriptions
- [GitHub Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) — retrieved June 2026
- [GitHub Privacy Statement and Terms update — March 25, 2026](https://github.blog/changelog/2026-03-25-updates-to-our-privacy-statement-and-terms-of-service-how-we-use-your-data/)
- [terms.law/ai-output-rights/github-copilot/](https://terms.law/ai-output-rights/github-copilot/) — 2026

**Important context on which terms apply:**

As of March 5, 2026, GitHub replaced the Copilot Product Specific Terms with the broader **GitHub Generative AI Services Terms** for all new subscriptions and renewals. Customers who licensed Copilot Business or Enterprise directly from GitHub *before* March 5, 2026 remain under the old terms. Customers via Microsoft are governed by Microsoft Product Terms, not this document.

For individual contributors using Copilot Free, Pro, or Pro+, the GitHub Terms of Service (Section J on AI features) applies, not the enterprise document.

### (a) Using Copilot to help write code you contribute to open source

**LIKELY OK.**

The March 2026 Generative AI Services Terms state clearly: *"GitHub does not own Inputs or Outputs. You retain any ownership you already have in your Inputs."* Commercial use is explicitly permitted.

The old Copilot Product Specific Terms said similarly: *"GitHub does not own Suggestions, and you retain ownership of Your Code."*

The primary open-source risk with Copilot is not GitHub's terms but the tool's training data. Copilot was trained on public GitHub repositories, some of which carry copyleft licenses (GPL, LGPL). Suggestions that substantially reproduce GPL-licensed training examples could impose copyleft obligations on code they are incorporated into. GitHub's IP indemnification (Copilot Business/Enterprise only) covers this to some extent, but the **Required Mitigations** referenced in the March 2026 terms (Microsoft Customer Copyright Commitment) require enabling the duplicate-detection / "public code filter" feature.

**For the Grove Commons model:** Individual contributors using Copilot should enable the public-code filter. Projects in the Grove Commons that require MIT-compatible output should document this requirement for contributors.

### (b) Automated / unattended generation vs. attended use

**NEEDS CARE (infrastructure pressure, not a TOS prohibition).**

The March 2026 terms place responsibility on users for any agent or application they build: *"you are solely responsible for any application or agent you create using (or for use with) Generative AI Services."* There is no outright ban on agentic or automated use under the enterprise terms.

However, GitHub has been visibly strained by agentic use patterns in 2026: it introduced session and weekly token-consumption limits, paused new Individual plan sign-ups at points, and added rate limits on parallel workflows. These are operational constraints, not TOS prohibitions.

For attended, one-at-a-time PR contribution, there is no conflict. A contributor running Copilot in their editor, reviewing suggestions, and opening a PR is standard attended use.

### (c) Ownership / licensing of AI-generated output — can the user license it MIT?

**LIKELY OK, with the public-code-filter caveat.**

GitHub/Microsoft's explicit assignment of output to users, combined with the IP indemnification under Business/Enterprise plans (via the Required Mitigations / Copyright Commitment), is the strongest formal IP protection of the tools covered here.

As with other tools, US copyright law means purely AI-generated suggestions lack copyright in themselves. The contributor's judgments, edits, and integration work are what confers copyright. MIT licensing is compatible; the contributor is asserting rights over their contribution as a whole.

**Tier dependency:** IP indemnification requires Copilot Business or Enterprise. Copilot Free/Pro users are on softer ground legally for indemnification, though the ownership terms still apply.

### (d) Restrictions on pooling output for a collective / commercial service

**LIKELY OK.**

The March 2026 terms impose no restriction on collective or commercial downstream use of code written with Copilot assistance. The Acceptable Use Policy and AI Code of Conduct are referenced but do not restrict receiving projects.

The April 2026 Individual plan training-data update (GitHub may use prompts and suggestions to improve AI models unless opted out) does not affect the MIT licensing status of code the user commits; it affects what GitHub learns from the session data.

---

## 4. Cursor (Anysphere)

### Sources consulted
- [Cursor Terms of Service](https://cursor.com/terms-of-service) — text fetched directly, June 2026
- [Cursor Community Forum — TOS discussion](https://forum.cursor.com/t/important-does-cursor-generate-copyrighted-code/74447)
- [terms.law — Cursor commercial use 2026](https://terms.law/forum/thread/cursor-ai-code-commercial-use-2026.html)
- [MindStudio — Cursor Kimi K2.5 licensing controversy](https://www.mindstudio.ai/blog/cursor-composer-2-kimi-k25-open-source-attribution)

**Important context:**

Cursor is an IDE, not a model provider. Cursor routes requests to underlying models (currently a mix of Anthropic Claude, OpenAI GPT-4-class models, and Anysphere's own fine-tunes). The Cursor ToS governs the *application layer*; the *model-layer* terms (Anthropic, OpenAI) govern what those models can generate and how outputs can be used. A Cursor user must satisfy both.

In early 2026 it emerged that Cursor's Composer 2 was built on Moonshot AI's Kimi K2.5, which carries a Modified MIT License requiring attribution for products exceeding $20M/month in revenue. This episode illustrates that the legal risk in AI-coding tools can come from undisclosed upstream model licenses, not just the application's ToS.

### (a) Using Cursor to help write code you contribute to open source

**LIKELY OK** (subject to underlying model terms and Cursor's upstream model transparency).

Cursor's ToS, Section 5.3: *"You retain all of your right, title, and interest that you have in Inputs, and Anysphere hereby assigns to you all of our right, title, and interest if any in and to any Suggestions."*

No restriction on OSS contributions appears in the current Cursor ToS. Cursor explicitly does not use content for model training (Section 1.3) unless the user opts in — a user-friendly provision.

**Caveat:** Because Cursor routes through multiple underlying models, contributors should be aware that the *effective* terms for a given suggestion depend on which model generated it. If Cursor is using Anthropic Claude as the backend, Anthropic's terms apply to that output. The model attribution is not always visible to the user.

### (b) Automated / unattended generation vs. attended use

**NEEDS CARE.**

Cursor's ToS, Section 1.7 addresses automatic code execution: *"By enabling this feature, you acknowledge and agree that you are assuming all risks associated with the execution of automatically generated code."* This is a risk-assumption clause for auto-run features, not a prohibition.

Cursor does not impose an explicit ban on agentic or unattended use in the ToS. However, using Cursor in a fully automated pipeline (no human reviewing suggestions before they are committed) creates both legal risk (who bears liability for the output?) and practical risk (the underlying model provider's terms may prohibit automated access via OAuth rather than API keys).

For attended Grove Commons use, there is no conflict.

### (c) Ownership / licensing of AI-generated output — can the user license it MIT?

**LIKELY OK** at the Cursor application layer. Same human-authorship caveats apply.

Cursor's explicit assignment of suggestion rights to the user, with no training-data use by default, is a clean position. The complication is that Cursor does not always disclose which underlying model produced a suggestion. If the model changes (as happened with Kimi K2.5) and carries a non-MIT-compatible upstream license, Cursor's assignment of "our right, title, and interest" may be worth less than it appears if Cursor itself did not have unfettered rights to the output.

**Recommendation:** For high-stakes licensing compliance, prefer tools with a single, disclosed, well-documented model provider.

### (d) Restrictions on pooling output for a collective / commercial service

**LIKELY OK** from Cursor's ToS perspective.

Section 1.5(v) prohibits using suggestions *"to develop or train a model that is competitive with the Service."* This is the standard anti-competition clause. It does not restrict receiving an open-source project from getting MIT-licensed contributions.

No pooling or collective-service restriction appears in the current Cursor ToS.

---

## 5. Google — Gemini CLI

### Sources consulted
- [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms) — last updated April 28, 2026; fetched directly June 2026
- [Gemini CLI TOS and Privacy Notice](https://google-gemini.github.io/gemini-cli/docs/tos-privacy.html) — retrieved June 2026
- [google-gemini/gemini-cli GitHub repo](https://github.com/google-gemini/gemini-cli) — Apache 2.0 license
- [FOSS Force — Gemini CLI bait-and-switch analysis](https://fossforce.com/2026/05/gemini-clis-short-life-and-googles-antigravity-bait-and-switch/)
- [TechTimes — Google accepted 6,000 contributions then closed](https://www.techtimes.com/articles/317056/20260523/google-accepted-6000-gemini-cli-contributions-then-closed-tool-enterprise-only.htm)
- Secondary: [terms.law — Gemini output rights 2026](https://terms.law/ai-output-rights/gemini/)

**Critical context — access shutdown in progress:**

Gemini CLI was released as open-source (Apache 2.0) in June 2025 with a free Gemini API tier, accumulating 100k+ GitHub stars and 6,000+ merged PRs. On May 19, 2026, Google announced it would shut down free API access effective June 18, 2026. Free users, Google AI Pro/Ultra subscribers, and individual Gemini Code Assist users all lose access on that date. Only enterprise users (Gemini Code Assist Standard or Enterprise license via Google Cloud org) retain API access.

Simultaneously, Google is replacing Gemini CLI with "Antigravity CLI" (`agy`) — a closed-source replacement, not open-source, without full feature parity at launch. Developers who contributed to Gemini CLI have called this a bait-and-switch: Google accepted community labor on an open-source project, then handed the future to enterprise customers.

Sources: [The Register — May 20, 2026](https://www.theregister.com/ai-ml/2026/05/20/bye-bye-gemini-cli-google-nudges-devs-toward-antigravity/5243605), [TechTimes — May 23, 2026](https://www.techtimes.com/articles/317056/20260523/google-accepted-6000-gemini-cli-contributions-then-closed-tool-enterprise-only.htm), [FOSS Force analysis](https://fossforce.com/2026/05/gemini-clis-short-life-and-googles-antigravity-bait-and-switch/)

**For Grove Commons contributors: Gemini CLI is effectively unavailable to non-enterprise users as of June 18, 2026. Antigravity CLI (the replacement) is closed-source and carries its own terms not yet analyzed here. Do not assume parity.**

### (a) Using Gemini CLI to help write code you contribute to open source

**LIKELY OK** for users who retain valid API access, subject to account type.

From the Gemini API Terms (April 28, 2026): *"Google won't claim ownership over that content."* The terms permit using outputs in downstream work. The Apache 2.0 license on the CLI itself is permissive and imposes no restrictions on using the tool to write code.

No explicit restriction on OSS contributions in the current Gemini API Terms.

**Access caveat:** As of June 18, 2026, free and individual-tier users cannot use Gemini CLI at all. The tool is operational only for enterprise customers. This is an access issue, not a terms issue, but it effectively blocks most community contributors.

### (b) Automated / unattended generation vs. attended use

**NEEDS CARE.**

The Gemini API Terms include an agentic-services section that mandates: developers *"will not automatically bypass any requests for human confirmation"* and must exercise judgment before production deployment, particularly avoiding *"safety-critical applications."*

This aligns well with the Grove Commons attended model (human reviews and opens the PR). The restriction on bypassing human confirmation would become relevant only if Grove built a fully automated pipeline.

Google AI Studio and the free Gemini API quota are explicitly restricted to *"developers building with Google AI models for professional or business purposes"* — they are not intended for general consumer products served at scale.

### (c) Ownership / licensing of AI-generated output — can the user license it MIT?

**LIKELY OK** at the terms layer, with the standard human-authorship nuance.

The Gemini API Terms also note: *"you acknowledge that Google may generate the same or similar content for others and that we reserve all rights to do so."* This means output is non-exclusive — Google can give the same suggestion to anyone. This does not affect a user's right to MIT-license their contribution; it means they cannot claim exclusive copyright over an identical output someone else also received.

**Account-type dependency on training data:** Individual Google accounts (non-paid) have their prompts and code potentially used to improve Google's products. Paid services (Cloud Billing / Workspace Enterprise) are treated as confidential and not used for training. This affects data privacy, not output licensing rights, but is worth noting for contributors handling proprietary context.

### (d) Restrictions on pooling output for a collective / commercial service

**NEEDS CARE.**

The Gemini API Terms forbid reverse-engineering the model or developing competing AI models using outputs. The Grounding with Google Search feature has an explicit prohibition on caching, syndicating, or training on grounded results — but this applies only to Search-grounded outputs, not general code generation.

No restriction on an open-source project with commercial elements receiving Gemini-generated MIT contributions.

**However:** The access-tier restructuring means Gemini CLI is effectively enterprise-only as of late June 2026. A community contribution workflow that depends on Gemini CLI will work only for contributors who are Google Cloud enterprise customers. This is a practical blocker for most community participants, regardless of terms.

---

## Cross-cutting observations

### Human-in-the-loop is the correct posture — legally and practically

All five providers' terms are compatible with the Grove Commons model when a human contributor:
1. Directs the AI (frames the problem, chooses the approach)
2. Reviews the output (reads and understands the generated patch)
3. Edits as needed (modifies for correctness and fit)
4. Opens the PR under their own identity
5. Takes responsibility for the contribution

This is not just terms compliance — it is also the copyright posture that makes MIT licensing legally meaningful. The *Thaler* line of cases has settled (at least in the US) that human authorship is required for copyright. A contribution where the human played a meaningful creative and editorial role is copyrightable by that human, and they can license it MIT.

### The "competing model" clause is universal

Every provider has a clause prohibiting use of outputs to train or develop competing AI models. Grove Commons does not do this; the commons is a code-contribution workflow. The clause does not restrict receiving MIT-licensed patches in an open-source project.

If Grove ever built tooling that *ingested* the generated patches to improve an AI model, that would require legal review against each provider's terms.

### Indemnification is tier-dependent

| Tool | IP Indemnification |
|------|--------------------|
| Anthropic | Commercial terms only (Team, Enterprise, API paid plans) |
| OpenAI | Enterprise/API (Services Agreement) |
| GitHub Copilot | Business and Enterprise plans only; via Microsoft Copyright Commitment |
| Cursor | Not offered explicitly |
| Gemini CLI | Not offered; enterprise access only after June 18, 2026 |

For community contributors using free or Pro consumer tiers, there is no indemnification backstop. The practical risk for MIT open-source work is low (no one is suing over small patches), but projects should be aware that indemnification coverage depends on each *contributor's* plan, not the project's.

### Training data opt-out varies

| Tool | Default data training | Opt-out available |
|------|-----------------------|-------------------|
| Anthropic (Consumer) | Yes, used to train | Yes, in Settings > Privacy |
| Anthropic (API/Commercial) | No, not used by default | N/A |
| OpenAI (Consumer) | Yes, used to train | Yes (account settings) |
| OpenAI (API/Enterprise) | No, not used | N/A |
| GitHub Copilot Free/Pro/Pro+ | Yes, as of April 2026 | Yes (plan settings) |
| GitHub Copilot Business/Enterprise | No | N/A |
| Cursor | No (explicit in ToS) | N/A |
| Gemini CLI (individual accounts) | Yes | Varies by feature |
| Gemini CLI (Cloud/Enterprise) | No | N/A |

Training data use does not affect the licensing of code committed to the Grove Commons, but it is a privacy concern contributors should know about.

---

## Overall verdict for the Grove Commons attended model

| Tool | Overall | Key condition |
|------|---------|--------------|
| Claude / Claude Code | LIKELY OK | Attended use; contributor uses own account; no automated pipeline; no model training from patches |
| ChatGPT / Codex | LIKELY OK | Same conditions; enable code-citation features if available |
| GitHub Copilot | LIKELY OK | Enable public-code filter; Business/Enterprise gets IP indemnification |
| Cursor | LIKELY OK | Attended use; note upstream model opacity; follow underlying model terms |
| Gemini CLI | NEEDS CARE | Access shut down for non-enterprise users June 18, 2026; replacement (Antigravity CLI) is closed-source with unreviewed terms |

No tool is **BLOCKED** for the attended, human-opens-the-PR model. Gemini CLI is the only tool in this survey with an active access-level blocker for community users. The clearest path is:
1. Contributors use the tool they have legitimate access to.
2. They review, edit, and own their contribution.
3. They open the PR under their own identity.
4. The PR description notes AI assistance was used (voluntary but increasingly a best practice in OSS communities).

---

## Bottom line

The Grove Commons contribution model — draft with your own AI tool, review it, open the PR yourself, a human maintainer merges — is compatible with the current terms of all five major AI coding tools, with one practical exception: **Gemini CLI is effectively unavailable to non-enterprise users as of June 18, 2026**.

The universal constraints are:
- Do not use the outputs to train a competing AI model.
- Do not route API calls through shared credentials or unattended pipelines; individual contributors should use their own accounts.
- Human review is both legally required (for meaningful copyright) and terms-expected.
- Gemini CLI specifically: non-enterprise users must either obtain a Google Cloud enterprise license or switch to a different tool as of June 18, 2026. The Antigravity CLI replacement has not been reviewed here.

Grove does not need to take any position in its COMMONS policy on *which* tool a contributor uses; the per-tool terms each permit the attended PR contribution model. Grove may want to document a disclosure norm ("contributions may be AI-assisted") and remind contributors that they take responsibility for the code they submit.

---

## Re-verify before relying on this document

**AI tool terms of service change frequently, sometimes without prominent notice.**

Before any public launch of Grove Commons, any commercial arrangement, or any legal reliance on the above:

1. Check each provider's current terms page (links above) for version dates.
2. Verify the Gemini CLI access situation (changes in progress as of this writing).
3. Confirm GitHub Copilot is now governed by the GitHub Generative AI Services Terms for your plan tier.
4. Note the US-centric copyright analysis; contributors in other jurisdictions (EU, UK, Japan) face different authorship rules for AI-generated content.
5. Consult a lawyer with IP and software licensing experience before making any policy that contributors will rely on legally.

*This document does not constitute legal advice.*

---

*Prepared for Grove Commons issue #1 — June 2026*
*Sources verified at dates noted above. All URLs should be re-verified before reliance.*
