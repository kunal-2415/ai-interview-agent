export function createAi(config) {
  const hasKey = Boolean(config.perplexityKey && config.perplexityKey.trim().length > 0);
  const models = [config.perplexityModel, ...config.perplexityFallbacks].filter(Boolean);
  const uniqueModels = [...new Set(models)];

  return {
    configured: true,
    isOffline: !hasKey,
    async buildPlan(input) {
      if (hasKey) {
        try {
          return await askApi(config, uniqueModels, planRequest(input), (raw) =>
            normalizePlan(raw, input.settings.questionCount)
          );
        } catch (err) {
          console.warn("[ai] API request failed, falling back to built-in AI engine:", err.message);
        }
      }
      return buildOfflinePlan(input);
    },
    async assessAnswer(input) {
      if (hasKey) {
        try {
          return await askApi(config, uniqueModels, assessRequest(input), normalizeAssessment);
        } catch (err) {
          console.warn("[ai] API assessment failed, falling back to built-in AI engine:", err.message);
        }
      }
      return assessOfflineAnswer(input);
    },
    async finalScore(input) {
      if (hasKey) {
        try {
          return await askApi(config, uniqueModels, scoreRequest(input), normalizeScore);
        } catch (err) {
          console.warn("[ai] API scoring failed, falling back to built-in AI engine:", err.message);
        }
      }
      return scoreOfflineSession(input);
    },
  };
}

export function parseJson(text) {
  const trimmed = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("The interviewer model did not return valid JSON.");
  }
}

async function askApi(config, models, request, normalize) {
  const isAgentEndpoint = config.perplexityModel?.includes("agent") || false;
  const endpoint = isAgentEndpoint
    ? "https://api.perplexity.ai/v1/agent"
    : "https://api.perplexity.ai/chat/completions";

  let body;
  if (isAgentEndpoint) {
    body = {
      model: models[0],
      models: models.slice(0, 5),
      input: request.input,
      instructions: request.instructions,
      max_output_tokens: request.maxOutputTokens || 3000,
      temperature: request.temperature || 0.3,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: request.schemaName,
          schema: request.schema,
          strict: true,
        },
      },
    };
  } else {
    // OpenAI-compatible Chat Completions
    body = {
      model: models[0] || "sonar-pro",
      temperature: request.temperature || 0.2,
      max_tokens: request.maxOutputTokens || 3000,
      messages: [
        {
          role: "system",
          content: `${request.instructions}\nYou MUST respond with ONLY valid JSON strictly adhering to the requested schema. Do not output markdown code blocks.`,
        },
        {
          role: "user",
          content: `${request.input}\n\nRequired JSON Schema structure:\n${JSON.stringify(request.schema, null, 2)}`,
        },
      ],
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.perplexityKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${raw.slice(0, 300)}`);
  }

  const data = JSON.parse(raw);
  let contentText = "";
  if (data.choices && data.choices[0]?.message?.content) {
    contentText = data.choices[0].message.content;
  } else if (data.output) {
    contentText = outputText(data);
  } else {
    contentText = JSON.stringify(data);
  }

  return normalize(parseJson(contentText));
}

export function outputText(data) {
  const parts = [];
  for (const item of data?.output || []) {
    if (item?.type !== "message") continue;
    for (const part of item.content || []) {
      if (part?.type === "output_text" && part.text) parts.push(part.text);
    }
  }
  return parts.join("\n").trim();
}

function interviewerRole(settings, candidateName = "Candidate") {
  return `You are a warm, highly empathetic and professional staff-level technical interviewer at ${settings.companyName}.
Candidate Name: ${candidateName}.
Role being hired: ${settings.targetRole}.
Interview language: ${settings.language}. Speak only in that language.
Hiring focus: ${settings.focusNotes}

Standards:
- ALWAYS begin Question 1 as a warm, human icebreaker & introduction:
  1. Greet the candidate warmly by their first name ("Hello [Name]! Welcome to ${settings.companyName}. How are you doing today?").
  2. Ask them to introduce themselves: "Could you tell me a little bit about yourself? Where are you currently based, what company or projects have you been working with recently, and could you briefly summarize your years of experience in the field?"
- Sound like an empathetic, friendly human interviewer, NOT a cold robotic quiz bot.
- If the candidate explicitly asks to skip, pass, or move on to the next question, respect their wish immediately with a polite human transition ("Understood, let's move right along to the next question.").
- One question at a time. Natural conversational spoken tone.
- Calibrate technical questions strictly to the candidate's actual domain (e.g. Data Analyst, DevOps, Frontend, Full Stack) and seniority based on their CV.
- Prefer real-world tradeoffs, debugging, data handling, and fundamentals they claim in their CV.
- Never reveal scores or internal rubrics.`;
}

function planRequest({ cvText, settings, candidateName }) {
  return {
    schemaName: "interview_plan",
    effort: "high",
    temperature: 0.4,
    maxOutputTokens: 6000,
    instructions: interviewerRole(settings, candidateName),
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["seniority", "topics", "questions"],
      properties: {
        seniority: { type: "string", enum: ["intern", "junior", "mid", "senior", "staff"] },
        topics: { type: "array", items: { type: "string" } },
        questions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["topic", "difficulty", "spoken", "onScreen", "strongAnswer", "followUpIfShallow"],
            properties: {
              topic: { type: "string" },
              difficulty: { type: "string", enum: ["warmup", "core", "deep"] },
              spoken: { type: "string" },
              onScreen: { type: "string" },
              strongAnswer: { type: "string" },
              followUpIfShallow: { type: "string" },
            },
          },
        },
      },
    },
    input: `Build an interview of exactly ${settings.questionCount} questions for candidate ${candidateName || "Candidate"} from this CV.
Question 1 MUST be a warm, human icebreaker & self-introduction (Greeting, how are they doing, where are they based, current company/projects, years of experience).
Subsequent questions must be tailored technical questions ordered warmup, core, and deep questions matching their CV domain.
Each spoken question must stand alone.
onScreen is empty or short contextual prompt.
CV:
${cvText}`,
  };
}

function assessRequest({ settings, question, followUps, answer, answerMs }) {
  return {
    schemaName: "answer_assessment",
    effort: "medium",
    temperature: 0.2,
    maxOutputTokens: 2500,
    instructions: interviewerRole(settings),
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["answerScore", "coverage", "followUp", "note"],
      properties: {
        answerScore: { type: "number" },
        coverage: { type: "string", enum: ["shallow", "partial", "strong"] },
        followUp: { type: "string" },
        note: { type: "string" },
      },
    },
    input: `Grade this spoken answer. answerScore is 0 to 10.
If the candidate says "move on", "next question", "skip", "pass", or "I don't know", do NOT provide a follow-up. Set followUp to empty string and coverage to "shallow".
Otherwise, if coverage is not strong, write one concise follow-up under 40 words probing the technical mechanism.

Topic: ${question.topic}
Difficulty: ${question.difficulty}
Question: ${question.spoken}
Private strong answer: ${question.strongAnswer}
Candidate answer:
${answer}`,
  };
}

function scoreRequest({ settings, cvText, transcript, integrity, strikes }) {
  const turns = transcript
    .map(
      (turn, index) =>
        `${index + 1}. [${turn.kind}] ${turn.question}\nAnswer (${turn.score}/10, ${turn.coverage}): ${turn.answer}\nNote: ${turn.note}`
    )
    .join("\n\n");
  const flags = integrity.filter((item) => item.strike).map((item) => `${item.type}: ${item.detail}`).join("\n");
  return {
    schemaName: "interview_score",
    effort: "high",
    temperature: 0.2,
    maxOutputTokens: 5000,
    instructions: interviewerRole(settings),
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "overall",
        "recommendation",
        "correctness",
        "depth",
        "problemSolving",
        "communication",
        "cvHonesty",
        "integrity",
        "summary",
        "strengths",
        "gaps",
        "integritySummary",
      ],
      properties: {
        overall: { type: "number" },
        recommendation: { type: "string", enum: ["strong_hire", "hire", "borderline", "no_hire"] },
        correctness: { type: "number" },
        depth: { type: "number" },
        problemSolving: { type: "number" },
        communication: { type: "number" },
        cvHonesty: { type: "number" },
        integrity: { type: "number" },
        summary: { type: "string" },
        strengths: { type: "array", items: { type: "string" } },
        gaps: { type: "array", items: { type: "string" } },
        integritySummary: { type: "string" },
      },
    },
    input: `Score the full interview.
overall is 0 to 100.
Dimension scores are 0 to 10: correctness, depth, problemSolving, communication, cvHonesty, integrity.
recommendation is strong_hire, hire, borderline, or no_hire.
summary is 5 to 8 sentences for the hiring manager.

Strikes recorded: ${strikes}
${flags || "No proctoring strikes."}

CV:
${cvText}

Transcript:
${turns || "The candidate ended before answering."}`,
  };
}

export function normalizePlan(raw, questionCount) {
  const questions = Array.isArray(raw.questions) ? raw.questions : [];
  const cleaned = questions
    .map((question, index) => ({
      id: `q${index + 1}`,
      topic: clip(question.topic, 80) || `Question ${index + 1}`,
      difficulty: ["warmup", "core", "deep"].includes(question.difficulty) ? question.difficulty : "core",
      spoken: clip(question.spoken, 800),
      onScreen: clip(question.onScreen, 1500),
      strongAnswer: clip(question.strongAnswer, 2000),
      followUpIfShallow: clip(question.followUpIfShallow, 800),
    }))
    .filter((question) => question.spoken.length > 15)
    .slice(0, questionCount);

  if (cleaned.length < Math.min(3, questionCount)) {
    throw new Error("The model did not produce enough interview questions.");
  }
  return {
    seniority: ["intern", "junior", "mid", "senior", "staff"].includes(raw.seniority) ? raw.seniority : "mid",
    topics: (Array.isArray(raw.topics) ? raw.topics : cleaned.map((question) => question.topic))
      .map((topic) => clip(topic, 60))
      .filter(Boolean)
      .slice(0, 6),
    questions: cleaned,
  };
}

export function normalizeAssessment(raw) {
  const coverage = ["shallow", "partial", "strong"].includes(raw.coverage) ? raw.coverage : "partial";
  return {
    answerScore: clamp(raw.answerScore, 0, 10),
    coverage,
    followUp: coverage === "strong" ? "" : clip(raw.followUp, 500),
    note: clip(raw.note, 800),
  };
}

export function normalizeScore(raw) {
  return {
    overall: clamp(raw.overall, 0, 100),
    recommendation: ["strong_hire", "hire", "borderline", "no_hire"].includes(raw.recommendation)
      ? raw.recommendation
      : "borderline",
    correctness: clamp(raw.correctness, 0, 10),
    depth: clamp(raw.depth, 0, 10),
    problemSolving: clamp(raw.problemSolving, 0, 10),
    communication: clamp(raw.communication, 0, 10),
    cvHonesty: clamp(raw.cvHonesty, 0, 10),
    integrity: clamp(raw.integrity, 0, 10),
    summary: clip(raw.summary, 2500) || "Comprehensive interview evaluation completed.",
    strengths: stringList(raw.strengths),
    gaps: stringList(raw.gaps),
    integritySummary: clip(raw.integritySummary, 800),
  };
}

// -------------------------------------------------------------
// Human-Like Intent Detection (Skip / Move on)
// -------------------------------------------------------------

export function isMoveOnOrSkipIntent(text) {
  const clean = String(text || "").toLowerCase().trim();
  if (!clean) return true;
  const patterns = [
    /\b(move on|next question|skip|pass|skip this|next please|skip it|move to next)\b/i,
    /\b(i don'?t know|no idea|don'?t know the answer|not sure about this|no answer)\b/i,
    /\b(let'?s go to the next|can we move|proceed to next|let'?s move ahead)\b/i,
    /\b(i haven'?t worked with|no experience with this|can we skip)\b/i,
    /\b(pass this|move ahead|next topic|go to next)\b/i,
  ];
  return patterns.some((p) => p.test(clean));
}

// -------------------------------------------------------------
// Built-in Domain-Aware Intelligence Engine
// Dynamically detects Data Analyst, Data Science, Frontend, Backend, DevOps, QA
// -------------------------------------------------------------

export function detectDomainAndRole(cvText) {
  const lower = cvText.toLowerCase();

  // Detect Seniority
  let seniority = "mid";
  if (lower.includes("staff") || lower.includes("principal") || lower.includes("architect") || lower.includes("director")) {
    seniority = "staff";
  } else if (lower.includes("senior") || lower.includes("lead") || /\b([6-9]|1[0-9])\+?\s*years?\b/i.test(cvText)) {
    seniority = "senior";
  } else if (lower.includes("intern") || lower.includes("trainee") || lower.includes("student")) {
    seniority = "intern";
  } else if (lower.includes("junior") || lower.includes("fresher") || /\b([0-2])\+?\s*years?\b/i.test(cvText)) {
    seniority = "junior";
  }

  // Domain score accumulator
  const domainKeywords = {
    data_analyst: [
      "data analyst", "bi analyst", "business intelligence", "tableau", "power bi",
      "sql", "excel", "pandas", "data visualization", "kpi", "dashboard", "looker",
      "etl", "data cleaning", "reporting", "data warehouse", "snowflake", "bigquery",
      "analytics", "metrics", "a/b testing", "data mining"
    ],
    data_scientist: [
      "data scientist", "machine learning", "deep learning", "nlp", "computer vision",
      "tensorflow", "pytorch", "scikit-learn", "regression", "classification", "clustering",
      "random forest", "neural network", "feature engineering"
    ],
    devops: [
      "devops", "sre", "cloud engineer", "terraform", "kubernetes", "k8s", "docker",
      "ci/cd", "jenkins", "ansible", "aws", "gcp", "azure", "prometheus", "grafana"
    ],
    frontend: [
      "frontend", "front-end", "react", "next.js", "vue", "angular", "css", "html",
      "javascript", "typescript", "tailwind", "redux", "ui developer", "responsive"
    ],
    qa: [
      "qa engineer", "quality assurance", "test automation", "selenium", "cypress",
      "playwright", "unit testing", "manual testing", "regression testing"
    ],
    backend_fullstack: [
      "full stack", "fullstack", "backend", "software engineer", "node.js", "express",
      "django", "fastapi", "spring boot", "microservices", "mongodb", "postgresql",
      "rest api", "graphql", "redis", "kafka", "system design"
    ]
  };

  const scores = {};
  for (const [dom, kws] of Object.entries(domainKeywords)) {
    scores[dom] = 0;
    for (const kw of kws) {
      if (lower.includes(kw)) scores[dom]++;
    }
  }

  // Find top scoring domain
  let topDomain = "backend_fullstack";
  let maxScore = 0;
  for (const [dom, count] of Object.entries(scores)) {
    if (count > maxScore) {
      maxScore = count;
      topDomain = dom;
    }
  }

  // Role title naming
  const prefix = seniority === "senior" ? "Senior " : seniority === "staff" ? "Staff " : seniority === "junior" ? "Junior " : "";
  let roleTitle = `${prefix}Software Engineer`;
  if (topDomain === "data_analyst") roleTitle = `${prefix}Data Analyst`;
  else if (topDomain === "data_scientist") roleTitle = `${prefix}Data Scientist`;
  else if (topDomain === "devops") roleTitle = `${prefix}DevOps / Cloud Engineer`;
  else if (topDomain === "frontend") roleTitle = `${prefix}Frontend Engineer`;
  else if (topDomain === "qa") roleTitle = `${prefix}QA Automation Engineer`;
  else if (topDomain === "backend_fullstack") roleTitle = `${prefix}Full Stack Engineer`;

  return { domain: topDomain, seniority, roleTitle };
}

export function buildOfflinePlan({ cvText, settings, candidateName }) {
  const { domain, seniority, roleTitle } = detectDomainAndRole(cvText);
  const targetRole = roleTitle || settings.targetRole || "Technical Specialist";
  const companyName = settings.companyName || "Our Organization";
  const count = settings.questionCount || 5;

  const candidate = String(candidateName || "").trim();
  const firstName = candidate.split(/\s+/)[0] || "there";

  const introQuestion = {
    id: "q_intro",
    topic: "Introduction & Background",
    difficulty: "warmup",
    spoken: `Hello ${firstName}! Welcome to ${companyName}. How are you doing today? I'm excited to speak with you about our ${targetRole} opportunity. To get us started, could you tell me a little bit about yourself? Where are you currently based, what company or projects have you been working with recently, and could you briefly summarize your years of experience in the field?`,
    onScreen: `👋 Welcome, ${candidate || "Candidate"}!\n• Introduce yourself: Current company, projects, and location / city\n• Total years of experience & core technical background\n• What excites you about this ${targetRole} role at ${companyName}?`,
    strongAnswer: "Greets warmly, shares location/city, current company/projects, years of experience, and key technical background with enthusiasm.",
    followUpIfShallow: `Thanks ${firstName}! Could you also share a bit about which city you're currently located in, and roughly how many years of overall experience you have?`,
  };

  let questions = [];
  let topics = [];

  if (domain === "data_analyst") {
    topics = ["SQL & Data Aggregation", "Data Cleaning & Transformation", "A/B Testing & Statistical Analysis", "Data Modeling & Warehousing", "Business Intelligence & KPI Dashboards"];

    questions = [
      {
        id: "q1",
        topic: "SQL & Analytics Project Overview",
        difficulty: "warmup",
        spoken: `Looking at your analytics background, could you walk me through a recent data project where you transformed complex, messy raw data into high-impact business insights or automated dashboards?`,
        onScreen: `// Data Analytics Project Context\nRole: ${targetRole}\nCore Stack: SQL, Tableau / Power BI, Python (Pandas), Excel\nFocus: Business Metrics, ETL Pipelines, and Insight Delivery`,
        strongAnswer: "Mentions data extraction sources, data cleaning techniques, joining tables, defining clear business KPIs, and quantifiable business outcomes.",
        followUpIfShallow: "What specific metric or KPI did you establish, and how did business stakeholders take action on your findings?",
      },
      {
        id: "q2",
        topic: "Advanced SQL & Window Functions",
        difficulty: "core",
        spoken: `In SQL, how would you calculate the month-over-month customer retention rate and identify customer accounts whose transaction volume suddenly dropped by more than 30%?`,
        onScreen: `-- SQL Retention & Volume Triage\nSELECT customer_id, transaction_date, amount,\n       LAG(amount) OVER (PARTITION BY customer_id ORDER BY transaction_date) as prev_amount,\n       ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY transaction_date DESC) as recency_rank\nFROM sales_transactions;`,
        strongAnswer: "Explains window functions (LAG, LEAD, ROW_NUMBER vs DENSE_RANK), partitioning, handling NULLs or zero division, and self-joins or CTEs.",
        followUpIfShallow: "Could you detail the difference between ROW_NUMBER, RANK, and DENSE_RANK when handling identical transaction values?",
      },
      {
        id: "q3",
        topic: "A/B Testing & Statistical Significance",
        difficulty: "core",
        spoken: `Suppose a product manager runs an A/B test on checkout conversion with 50,000 users. Variant A has a 4.2% conversion and Variant B has 4.7% with p-value 0.04. How do you evaluate whether this result is statistically sound, and what risks like sample ratio mismatch would you audit?`,
        onScreen: `// A/B Experiment Analysis\nControl (A): 25,000 users | Conversion: 4.2%\nTreatment (B): 25,000 users | Conversion: 4.7%\nP-Value: 0.04 | Confidence: 95%\nQuestion: What confounding factors or statistical caveats do you check before rollout?`,
        strongAnswer: "Discusses sample ratio mismatch (SRM), statistical power, minimum detectable effect (MDE), false positives, seasonality, and novelty effect.",
        followUpIfShallow: "How would you determine if the observed lift was driven by a novelty effect rather than genuine sustained conversion?",
      },
      {
        id: "q4",
        topic: "Data Warehousing & Star Schema",
        difficulty: "deep",
        spoken: `When designing data marts for business reporting, how do you structure Fact and Dimension tables in a Star Schema, and how do you handle Slowly Changing Dimensions when customer attributes change over time?`,
        onScreen: `[Star Schema Structure]\nFact_Sales (sale_id, customer_key, product_key, date_key, revenue, quantity)\n  ├── Dim_Customer (customer_key, customer_id, tier, region, effective_date, is_current)\n  ├── Dim_Product (product_key, product_id, category, price)\n  └── Dim_Date (date_key, calendar_date, month, quarter, year)`,
        strongAnswer: "Explains Fact vs Dimension separation, surrogate keys, SCD Type 1 (overwrite) vs SCD Type 2 (historical versioning with effective date ranges), and query performance benefits.",
        followUpIfShallow: "When would you choose an SCD Type 2 approach over Type 1, and how does it impact historical revenue aggregation?",
      },
      {
        id: "q5",
        topic: "Stakeholder Communication & Data Discrepancies",
        difficulty: "deep",
        spoken: `Imagine two executive dashboards report conflicting revenue numbers for the same quarter due to different attribution logic. How do you investigate the discrepancy, reconcile the definitions, and communicate the resolution to leadership?`,
        onScreen: `// Incident Scenario: Conflicting Metric Definitions\nDashboard A (Marketing): Q3 Revenue = $12.4M (Attribution on Lead Creation Date)\nDashboard B (Finance): Q3 Revenue = $10.9M (Attribution on Cash Settlement Date)\nTask: Root cause, reconcile single source of truth, and align executive stakeholders.`,
        strongAnswer: "Outlines code audit, identifying divergence in filter logic or time windows, establishing a single source of truth data dictionary, and conducting alignment meetings.",
        followUpIfShallow: "What governance framework or automated testing would you introduce to prevent conflicting metrics from reaching executive dashboards in the future?",
      },
    ];
  } else if (domain === "devops") {
    topics = ["Infrastructure as Code", "Container Orchestration", "CI/CD & Deployments", "Observability & SRE", "Security & Zero Trust"];
    questions = [
      {
        id: "q1",
        topic: "Cloud Architecture & IaC",
        difficulty: "warmup",
        spoken: `Looking at your infrastructure and DevOps background, could you walk me through your experience managing infrastructure as code with Terraform or CloudFormation across multi-region environments?`,
        onScreen: `// Infrastructure Scope\nProvider: AWS / GCP / Azure | Tooling: Terraform, Docker, Kubernetes\nFocus: Multi-environment state management and automated provisioning`,
        strongAnswer: "Explains remote state backends, state locking with DynamoDB, modular Terraform design, and environment separation.",
        followUpIfShallow: "How do you manage drift detection and prevent accidental destructive updates during team deployments?",
      },
      {
        id: "q2",
        topic: "Kubernetes Pod Lifecycle & Failure Modes",
        difficulty: "core",
        spoken: `In Kubernetes, what sequence of events occurs when a pod receives a SIGTERM during a rolling deployment, and how do you configure preStop hooks and readiness probes to guarantee zero dropped requests?`,
        onScreen: `apiVersion: apps/v1\nkind: Deployment\nspec:\n  template:\n    spec:\n      containers:\n      - name: api\n        lifecycle:\n          preStop:\n            exec:\n              command: ["/bin/sh", "-c", "sleep 15"]`,
        strongAnswer: "Covers kube-proxy iptables propagation, graceful shutdown, readiness probe detaching, connection draining, and terminationGracePeriodSeconds.",
        followUpIfShallow: "Why is a preStop sleep hook often necessary even when an application handles SIGTERM cleanly?",
      },
      {
        id: "q3",
        topic: "CI/CD & Canary Deployments",
        difficulty: "core",
        spoken: `How do you design a progressive canary deployment pipeline using ArgoCD or GitOps, and what metrics dictate an automated instant rollback?`,
        onScreen: `Canary Analysis:\n- Metric: HTTP 5xx error rate < 0.1%\n- Metric: P99 Latency < 250ms\n- Step: 10% traffic -> 25% -> 50% -> 100%`,
        strongAnswer: "Discusses service meshes (Istio/Envoy), Argo Rollouts, Prometheus query evaluation, automated threshold rollback, and database schema backward compatibility.",
        followUpIfShallow: "How do you handle database migrations during canary rollouts when the new code expects a schema change?",
      },
      {
        id: "q4",
        topic: "Production Outage Post-Mortem",
        difficulty: "deep",
        spoken: `Walk me through a severe production outage you triaged. What observability tools did you use to isolate whether the root cause was network saturation, OOM killer, or thread exhaustion?`,
        onScreen: `// Incident Triage\nAlert: P99 latency degraded from 80ms to 6,200ms.\nKubernetes: OOMKilled events on worker pods\nGrafana: Connection pool exhaustion on primary DB`,
        strongAnswer: "Details structured debugging: checking dmesg/kernel logs, container memory limits, DB connection pool leak, resolving the issue and writing a blameless post-mortem.",
        followUpIfShallow: "What specific metric or log entry pinpointed the root cause, and how did you configure alerting to catch it earlier?",
      },
      {
        id: "q5",
        topic: "Cloud Security & Secret Management",
        difficulty: "deep",
        spoken: `How do you implement least-privilege IAM and secure secrets management without baking credentials into containers or environment variables?`,
        onScreen: `Security Stack:\n- HashiCorp Vault / AWS Secrets Manager\n- IAM Roles for Service Accounts (IRSA)\n- Mutual TLS (mTLS) with Istio`,
        strongAnswer: "Explains dynamic short-lived credentials, IRSA/workload identity, secrets injection via mutating admission webhooks, and audit logging.",
        followUpIfShallow: "How do you rotate secrets without restarting application pods or causing downtime?",
      },
    ];
  } else if (domain === "frontend") {
    topics = ["Modern Framework Internals", "Web Performance & Core Vitals", "State Architecture", "Browser Rendering & CSS", "Accessibility & Security"];
    questions = [
      {
        id: "q1",
        topic: "Frontend Architecture & Project Tour",
        difficulty: "warmup",
        spoken: `Looking at your frontend background, could you describe the architecture of a complex web application you built, focusing on your component hierarchy and state boundaries?`,
        onScreen: `// Frontend Architecture Context\nRole: ${targetRole}\nStack: React / Next.js / TypeScript, CSS/Tailwind, State Management\nGoal: Component Reusability & Responsive UI Design`,
        strongAnswer: "Explains atomic component design, separation of UI and business logic, server vs client components, and caching strategies.",
        followUpIfShallow: "How did you manage shared state across deeply nested components without unnecessary re-renders?",
      },
      {
        id: "q2",
        topic: "React Rendering Pipeline & Optimization",
        difficulty: "core",
        spoken: `How does the React reconciliation algorithm differ between React 18 Concurrent Mode and previous versions, and how do you profile and eliminate memory leaks caused by closures or event listeners?`,
        onScreen: `function SearchList({ items }) {\n  const [query, setQuery] = useState("");\n  // How do you prevent blocking the main thread\n  // while filtering 50,000 items on every keystroke?\n  return <input value={query} onChange={e => setQuery(e.target.value)} />;\n}`,
        strongAnswer: "Mentions Fiber tree, useTransition / useDeferredValue, virtualized lists (windowing), web workers, and cleaning up listeners in useEffect.",
        followUpIfShallow: "When would you choose useDeferredValue over a standard debounce function for live search input?",
      },
      {
        id: "q3",
        topic: "Core Web Vitals & Loading Performance",
        difficulty: "core",
        spoken: `If an audit reports poor Largest Contentful Paint (LCP) and high Cumulative Layout Shift (CLS), what step-by-step investigation sequence do you run to optimize them?`,
        onScreen: `Lighthouse Audit:\n- LCP: 4.8s (Needs Improvement)\n- CLS: 0.32 (Poor)\n- Total Blocking Time (TBT): 850ms`,
        strongAnswer: "Covers font display swap, explicit image dimensions, preloading critical assets, tree shaking, critical CSS extraction, and deferring non-essential scripts.",
        followUpIfShallow: "What specific layout change typically triggers a high CLS, and how does reserve aspect-ratio fix it?",
      },
      {
        id: "q4",
        topic: "Browser Security: XSS, CSRF & CSP",
        difficulty: "deep",
        spoken: `How do you secure a single-page application against Cross-Site Scripting (XSS) and token theft when handling authentication tokens?`,
        onScreen: `Auth Token Storage:\nOption A: localStorage vs Option B: httpOnly, SameSite=Strict Cookie\nContent-Security-Policy (CSP): default-src 'self'; script-src 'self' 'nonce-...'`,
        strongAnswer: "Explains risks of localStorage token theft via XSS, advantages of httpOnly SameSite cookies, CSRF protection headers, and strict CSP headers with nonces.",
        followUpIfShallow: "If you must store tokens in memory, how do you handle silent refresh tokens across page reloads without exposing vulnerabilities?",
      },
      {
        id: "q5",
        topic: "Microfrontends & Design Systems",
        difficulty: "deep",
        spoken: `When building an enterprise design system shared across multiple teams, how do you manage versioning, accessibility (ARIA), and preventing CSS style bleeding?`,
        onScreen: `Design System Scope:\n- Semantic Tokens (colors, spacing, typography)\n- Headless Components with Radix/ARIA\n- Shadow DOM vs CSS Modules vs Tailwind prefixes`,
        strongAnswer: "Details semantic token architecture, WCAG AA compliance, automated visual regression testing (Chromatic/Playwright), and semantic versioning.",
        followUpIfShallow: "How do you test and ensure screen reader accessibility for complex custom select or modal dropdowns?",
      },
    ];
  } else {
    // Backend / Full Stack / Default
    topics = ["Distributed Architecture", "Concurrency & Database Locking", "Production Debugging", "Scalability & Caching", "Security & System Reliability"];
    questions = [
      {
        id: "q1",
        topic: "Architecture & Core Project Decisions",
        difficulty: "warmup",
        spoken: `Looking at your technical experience, could you walk me through the architecture of a recent complex service or application you worked on, highlighting the core technical decisions you made?`,
        onScreen: `// Candidate Background Context\nRole: ${targetRole}\nFocus: Production Architecture, API Design, and Database Choice`,
        strongAnswer: "Explains high-level data flow, backend/frontend separation, component boundaries, reasons for selecting specific databases/frameworks, and quantifiable impact.",
        followUpIfShallow: "Could you be specific about the data flow between services and what trade-offs influenced your framework or architectural choices?",
      },
      {
        id: "q2",
        topic: "Concurrency, Transactions & Locking",
        difficulty: "core",
        spoken: `How do you manage consistency, asynchronous state, and concurrency bottlenecks when handling high-volume concurrent updates to the same database records?`,
        onScreen: `async function handleUserEvent(event) {\n  // What happens when 1,000 requests hit this concurrently?\n  const user = await db.find(event.userId);\n  user.balance += event.amount;\n  await db.save(user);\n}`,
        strongAnswer: "Discusses database transactions, pessimistic vs optimistic locking, idempotent operations, race condition prevention, or atomic operations with Redis/queues.",
        followUpIfShallow: "How would you prevent race conditions and dirty writes when multiple instances update the same resource at the exact same millisecond?",
      },
      {
        id: "q3",
        topic: "Production Outage & Diagnostic Telemetry",
        difficulty: "core",
        spoken: `Tell me about the most difficult bug, performance regression, or production outage you've debugged. What telemetry or tools did you use to isolate the root cause, and how did you prevent it from reoccurring?`,
        onScreen: `// Production Outage Scenario\nSymptom: P99 latency spikes from 120ms to 4,500ms under 3x load.\nCPU: 45% | Memory: 85% | DB Connections: Exhausted\nQuestion: What is your triage process?`,
        strongAnswer: "Mentions APM tools (Datadog, Prometheus), profiling connection pools, slow query logs, thread starvation, root cause discovery, and permanent fix with automated alerting.",
        followUpIfShallow: "What specific metric or log entry gave away the exact root cause, and what architectural safeguards did you introduce?",
      },
      {
        id: "q4",
        topic: "Scalability, Caching & Sharding",
        difficulty: "deep",
        spoken: `Suppose our service needs to scale from 10,000 to 1 million daily active users. How would you design the caching and database partitioning strategy, and how do you handle cache invalidation during network partitions?`,
        onScreen: `[Client] -> [API Gateway / Load Balancer]\n            |-> [Service Nodes (Cluster)]\n            |-> [Cache: Redis vs Memcached]\n            |-> [Database: Read/Write Split & Sharding]`,
        strongAnswer: "Covers read-replicas, write-through vs cache-aside, cache stampede prevention, consistent hashing, TTL policies, and CAP theorem trade-offs.",
        followUpIfShallow: "How do you guarantee that a stale cache entry isn't served after an immediate database update?",
      },
      {
        id: "q5",
        topic: "Resilience, Security & Code Quality",
        difficulty: "deep",
        spoken: `When shipping mission-critical features under tight deadlines, how do you balance technical debt, automated testing, and security fundamentals like rate limiting, auth tokens, and SQL/XSS prevention?`,
        onScreen: `// Security & Resilience Checklist\n- Auth: JWT vs Session Store\n- Rate Limiting: Token Bucket vs Leaky Bucket\n- Reliability: Circuit Breakers & Fallbacks`,
        strongAnswer: "Explains layered defense, token bucket algorithms, automated integration testing, CI/CD gates, circuit breakers, and disciplined refactoring cycles.",
        followUpIfShallow: "What specific circuit breaker or rate limiting threshold would you configure, and how does the client recover gracefully?",
      },
    ];
  }

  // Prepend human introduction question to interview plan
  const allQuestions = [introQuestion, ...questions];
  const allTopics = ["Introduction & Background", ...topics];

  // Adjust to requested count
  return {
    seniority,
    domain,
    topics: allTopics,
    detectedRole: targetRole,
    questions: allQuestions.slice(0, count),
  };
}

export function assessOfflineAnswer({ question, followUps, answer, answerMs }) {
  const text = String(answer || "").trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const lower = text.toLowerCase();

  // If candidate is asking to move on or skip, behave gracefully like a human!
  if (isMoveOnOrSkipIntent(text)) {
    return {
      answerScore: 0,
      coverage: "skipped",
      isSkipped: true,
      followUp: "", // NO FOLLOW UP!
      note: "Candidate requested to move to the next question.",
    };
  }

  // Handle warm human introduction question gracefully
  if (question.id === "q_intro" || question.topic?.includes("Introduction")) {
    const introKeywords = ["year", "experience", "work", "company", "based", "located", "city", "currently", "project", "role", "analyst", "engineer", "developer", "tech", "graduated", "hello", "hi", "good", "myself", "working", "team", "build"];
    let introMatches = 0;
    for (const kw of introKeywords) {
      if (lower.includes(kw)) introMatches++;
    }
    const score = Math.min(10, Math.max(7, 7 + (introMatches >= 2 ? 1.5 : 0.5) + (words >= 15 ? 1 : 0)));
    return {
      answerScore: Math.round(score * 10) / 10,
      coverage: score >= 8 ? "strong" : "partial",
      isSkipped: false,
      followUp: "", // Do not interrupt or push follow-ups on self-intro!
      note: "Candidate shared personal background, current organization, location/city, and experience overview.",
    };
  }

  const techKeywords = [
    "because", "tradeoff", "latency", "cache", "database", "scale", "performance",
    "architecture", "transaction", "async", "index", "memory", "cpu", "queue",
    "error", "log", "metrics", "security", "distributed", "lock", "api", "query",
    "sql", "join", "group by", "kpi", "dashboard", "tableau", "power bi", "pandas",
    "retention", "a/b test", "p-value", "significance", "dimension", "fact", "star schema",
    "scd", "reconciliation", "outage", "profiling", "circuit breaker", "partition"
  ];

  let matches = 0;
  for (const kw of techKeywords) {
    if (lower.includes(kw)) matches++;
  }

  let answerScore = 5;
  let coverage = "partial";
  let followUp = "";
  let note = "";

  if (words < 8) {
    answerScore = 3;
    coverage = "shallow";
    note = "Brief response without concrete technical explanation.";
    followUp = question.followUpIfShallow || "Could you share a bit more detail about the specific implementation or mechanism?";
  } else if (words < 20 && matches < 2) {
    answerScore = 4.5;
    coverage = "shallow";
    note = "High-level answer with limited technical details.";
    followUp = question.followUpIfShallow || "What specific constraints or tradeoffs did you consider in that scenario?";
  } else if (matches >= 3 && words >= 30) {
    answerScore = Math.min(10, 7.5 + (matches >= 5 ? 1.5 : 0.8) + (words > 60 ? 0.7 : 0));
    coverage = answerScore >= 8.5 ? "strong" : "partial";
    note = "Strong domain understanding with clear technical rationale and trade-offs.";
    if (coverage !== "strong" && followUps < 1) {
      followUp = question.followUpIfShallow || "How did you verify this in production or confirm metric accuracy?";
    }
  } else {
    answerScore = Math.min(7.5, 5 + matches * 0.5 + (words > 25 ? 1 : 0));
    coverage = "partial";
    note = "Reasonable understanding demonstrated; some specific mechanics could be deeper.";
    if (followUps < 1) {
      followUp = question.followUpIfShallow || "Could you detail what trade-offs you considered and why alternative approaches were rejected?";
    }
  }

  return {
    answerScore: Math.round(answerScore * 10) / 10,
    coverage,
    isSkipped: false,
    followUp: coverage === "strong" ? "" : followUp,
    note,
  };
}

export function scoreOfflineSession({ cvText, transcript, strikes, recordingBytes = 1000 }) {
  const turns = transcript || [];
  const count = turns.length;

  const validAnswers = turns.filter(
    (t) => !t.isSkipped && !isMoveOnOrSkipIntent(t.answer) && Number(t.score) > 0 && String(t.answer || "").trim().split(/\s+/).length >= 5
  );

  const hasStream = recordingBytes > 0;

  // If candidate skipped all questions or provided zero substantive answers:
  if (validAnswers.length === 0 || count === 0) {
    return {
      overall: 0,
      recommendation: "no_hire",
      correctness: 0,
      depth: 0,
      problemSolving: 0,
      communication: 0,
      cvHonesty: 0,
      integrity: hasStream ? Math.max(0, 10 - (strikes || 0) * 3) : 0,
      summary: `The candidate completed 0 out of ${count} interview questions. All questions were skipped or unattempted. Recommended status: NO HIRE (INCOMPLETE).`,
      strengths: ["No technical competency demonstrated (all evaluation questions were skipped or unattempted)."],
      gaps: [
        "Candidate skipped or was unable to answer evaluation questions.",
        "Zero demonstrated domain competency across assessed topics.",
        hasStream ? "No verbal or written responses provided." : "CRITICAL: No camera or microphone video stream was recorded."
      ],
      integritySummary: hasStream
        ? (strikes > 0 ? `${strikes} integrity strike(s) recorded.` : "Zero valid responses submitted.")
        : "PROCTORING FAILED: No webcam or microphone video feed was recorded.",
    };
  }

  let totalScore = 0;
  for (const turn of turns) {
    totalScore += turn.isSkipped ? 0 : (Number(turn.score) || 0);
  }
  const avgTurn = count > 0 ? totalScore / count : 0;

  const integrityScore = hasStream ? Math.max(0, 10 - (strikes || 0) * 3) : 0;
  const correctness = Math.min(10, Math.round((avgTurn * 0.95 + 0.3) * 10) / 10);
  const depth = Math.min(10, Math.round((avgTurn * 0.9 + 0.5) * 10) / 10);
  const problemSolving = Math.min(10, Math.round((avgTurn * 0.92 + 0.4) * 10) / 10);
  const communication = Math.min(10, Math.round((avgTurn * 0.88 + 0.8) * 10) / 10);
  const cvHonesty = Math.min(10, Math.round((avgTurn * 0.9 + 0.6) * 10) / 10);

  let overall = Math.round(
    (correctness * 0.25 + depth * 0.25 + problemSolving * 0.2 + communication * 0.15 + cvHonesty * 0.15) * 10
  );

  if (strikes >= 3 || !hasStream) overall = Math.min(overall, 45);

  let recommendation = "borderline";
  if (overall >= 78 && strikes === 0 && hasStream) recommendation = "strong_hire";
  else if (overall >= 65 && strikes <= 1 && hasStream) recommendation = "hire";
  else if (overall < 50 || strikes >= 3 || !hasStream) recommendation = "no_hire";

  const strengths = [];
  const strongTurns = turns.filter((t) => Number(t.score) >= 6);
  if (strongTurns.length > 0 && overall >= 50) {
    strengths.push("Demonstrated practical domain competency aligned with their background");
    strengths.push("Articulated technical reasoning and problem breakdown clearly");
    strengths.push("Maintained composure during technical evaluation");
  } else if (validAnswers.length > 0) {
    strengths.push("Attempted responses, but answers lacked technical depth and required detail");
  } else {
    strengths.push("None observed — no substantive answers were submitted");
  }

  const gaps = [];
  const skippedCount = turns.filter((t) => t.isSkipped || Number(t.score) === 0).length;
  if (skippedCount > 0) {
    gaps.push(`Skipped or gave no substantive answer to ${skippedCount} question(s)`);
  }
  if (strikes > 0) {
    gaps.push(`Incurred ${strikes} proctoring integrity strike(s)`);
  }
  if (!hasStream) {
    gaps.push("Missing proctoring telemetry: No camera or microphone feed was captured");
  }
  if (overall < 60) {
    gaps.push("Need stronger foundation on core system architecture and trade-off analysis");
  } else {
    gaps.push("Could dive deeper into statistical edge cases or large-scale data nuances");
  }

  const summary = `The candidate completed ${validAnswers.length} of ${count} interview questions. Overall evaluated score: ${overall}/100. ${
    !hasStream
      ? "CRITICAL: No camera or microphone feed was captured."
      : strikes > 0
      ? `Automated proctoring noted ${strikes} strike(s).`
      : "Session integrity was cleanly verified with zero proctoring infractions."
  } Recommended status: ${recommendation.replace("_", " ").toUpperCase()}.`;

  return {
    overall,
    recommendation,
    correctness,
    depth,
    problemSolving,
    communication,
    cvHonesty,
    integrity: integrityScore,
    summary,
    strengths,
    gaps,
    integritySummary: !hasStream
      ? "FAILED: Zero video or audio was captured during proctoring."
      : strikes > 0
      ? `${strikes} integrity strike(s) recorded.`
      : "Session integrity verified cleanly with no strikes.",
  };
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => clip(item, 240)).filter(Boolean).slice(0, 6);
}

function clip(value, max) {
  return String(value || "").trim().slice(0, max);
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}
