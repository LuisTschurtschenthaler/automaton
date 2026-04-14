/**
 * EU Regulatory Compliance Policy Rules
 *
 * Enforces compliance with EU regulations including:
 * - EU AI Act (Regulation 2024/1689): Transparency, risk classification, human oversight
 * - GDPR (Regulation 2016/679): Personal data processing restrictions
 * - MiCA (Regulation 2023/1114): Markets in Crypto-Assets
 * - Italian gambling law (ADM): Prediction market / betting prohibition
 * - Consumer protection: Anti-fraud, anti-deception
 *
 * These rules CANNOT be overridden by the agent, skills, or genesis prompt.
 * They are enforced at the policy engine level before any tool execution.
 */

import type {
  PolicyRule,
  PolicyRequest,
  PolicyRuleResult,
} from "../../types.js";

function deny(
  rule: string,
  reasonCode: string,
  humanMessage: string,
): PolicyRuleResult {
  return { rule, action: "deny", reasonCode, humanMessage };
}

// ─── Prohibited Domains ──────────────────────────────────────────

/**
 * Domains associated with prediction markets, gambling, and unlicensed
 * financial trading platforms. Blocked under Italian ADM regulations
 * and EU consumer protection law.
 */
const PROHIBITED_GAMBLING_DOMAINS = [
  // Prediction markets
  "polymarket.com",
  "kalshi.com",
  "manifold.markets",
  "metaculus.com",
  "predictit.org",
  "augur.net",
  "gnosis.io",
  "azuro.org",
  "overtime.markets",
  "hedgehog.markets",
  "drift.trade",
  // Online gambling / betting
  "stake.com",
  "rollbit.com",
  "roobet.com",
  "duelbits.com",
  "gamdom.com",
  "bc.game",
  "shuffle.com",
  // DeFi derivatives / leveraged trading (unlicensed in EU)
  "dydx.exchange",
  "gmx.io",
  "gains.trade",
  "kwenta.eth.limo",
  "perp.com",
  "mux.network",
  "hyperliquid.xyz",
] as const;

/**
 * URL patterns in shell commands that indicate interaction with prohibited platforms.
 */
const PROHIBITED_URL_PATTERNS: { pattern: RegExp; description: string }[] = [
  { pattern: /polymarket\.com/i, description: "Polymarket prediction market (banned by Italian ADM)" },
  { pattern: /kalshi\.com/i, description: "Kalshi prediction market" },
  { pattern: /predictit\.org/i, description: "PredictIt prediction market" },
  { pattern: /augur\.net/i, description: "Augur decentralized prediction market" },
  { pattern: /manifold\.markets/i, description: "Manifold Markets prediction market" },
  { pattern: /metaculus\.com/i, description: "Metaculus prediction market" },
  { pattern: /stake\.com/i, description: "Stake online gambling platform" },
  { pattern: /rollbit\.com/i, description: "Rollbit gambling platform" },
  { pattern: /roobet\.com/i, description: "Roobet gambling platform" },
  { pattern: /dydx\.exchange/i, description: "dYdX unlicensed derivatives exchange" },
  { pattern: /gmx\.io/i, description: "GMX unlicensed leveraged trading" },
  { pattern: /hyperliquid\.xyz/i, description: "Hyperliquid unlicensed derivatives" },
];

/**
 * Shell command patterns that indicate prohibited financial activities.
 */
const PROHIBITED_ACTIVITY_PATTERNS: { pattern: RegExp; description: string }[] = [
  // Prediction market CLIs and SDKs
  { pattern: /polymarket|poly-market|clob-client/i, description: "Polymarket SDK/CLI interaction" },
  { pattern: /kalshi-python|kalshi.*api/i, description: "Kalshi API interaction" },
  // Gambling bot frameworks
  { pattern: /casino.*bot|gambling.*bot|betting.*bot/i, description: "Gambling bot software" },
  { pattern: /sports.*betting|bet.*api|wager/i, description: "Betting/wagering activity" },
  // Unlicensed trading
  { pattern: /leveraged.*trad|margin.*trad|perpetual.*swap/i, description: "Leveraged/margin trading (unlicensed)" },
  { pattern: /flash.*loan|sandwich.*attack|mev.*bot|frontrun/i, description: "DeFi exploitation (MEV/sandwich/frontrun)" },
  // Money laundering indicators
  { pattern: /tornado.*cash|tornado\.cash/i, description: "Tornado Cash mixer (EU-sanctioned)" },
  { pattern: /mixer|tumbler|coin.*join/i, description: "Cryptocurrency mixing service" },
];

// ─── Rule Implementations ────────────────────────────────────────

/**
 * Block x402 payments to prohibited gambling/prediction market domains.
 * Priority 200 = runs before financial rules (500) to fail fast.
 */
function createProhibitedDomainRule(): PolicyRule {
  return {
    id: "eu_compliance.prohibited_domains",
    description: "Block payments to prediction markets, gambling, and unlicensed trading platforms (EU/Italian law)",
    priority: 200,
    appliesTo: { by: "name", names: ["x402_fetch"] },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const url = request.args.url as string | undefined;
      if (!url) return null;

      let hostname: string;
      try {
        hostname = new URL(url).hostname;
      } catch {
        return null; // Let validation rule handle bad URLs
      }

      for (const domain of PROHIBITED_GAMBLING_DOMAINS) {
        if (hostname === domain || hostname.endsWith(`.${domain}`)) {
          return deny(
            "eu_compliance.prohibited_domains",
            "EU_PROHIBITED_DOMAIN",
            `Blocked: "${hostname}" is a prohibited platform under EU/Italian regulations. Prediction markets, gambling, and unlicensed financial trading are illegal in Italy (ADM ban, October 2025).`,
          );
        }
      }

      return null;
    },
  };
}

/**
 * Block shell commands that interact with prohibited platforms or activities.
 * Scans exec commands for URLs and activity patterns.
 */
function createProhibitedActivityRule(): PolicyRule {
  return {
    id: "eu_compliance.prohibited_activities",
    description: "Block shell commands interacting with gambling, prediction markets, or unlicensed trading",
    priority: 200,
    appliesTo: { by: "name", names: ["exec", "install_npm_package", "install_mcp_server"] },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const command = (request.args.command ?? request.args.package ?? "") as string;
      if (!command) return null;

      // Check prohibited URLs in commands
      for (const { pattern, description } of PROHIBITED_URL_PATTERNS) {
        if (pattern.test(command)) {
          return deny(
            "eu_compliance.prohibited_activities",
            "EU_PROHIBITED_ACTIVITY",
            `Blocked: ${description}. Interaction with this platform violates EU/Italian regulations.`,
          );
        }
      }

      // Check prohibited activity patterns
      for (const { pattern, description } of PROHIBITED_ACTIVITY_PATTERNS) {
        if (pattern.test(command)) {
          return deny(
            "eu_compliance.prohibited_activities",
            "EU_PROHIBITED_ACTIVITY",
            `Blocked: ${description}. This activity is prohibited under EU regulations.`,
          );
        }
      }

      return null;
    },
  };
}

/**
 * Block file writes that create gambling/trading bot code.
 * Scans write_file content for prohibited activity indicators.
 */
function createProhibitedContentRule(): PolicyRule {
  return {
    id: "eu_compliance.prohibited_content",
    description: "Block writing code that implements gambling, prediction market trading, or unlicensed financial activities",
    priority: 200,
    appliesTo: { by: "name", names: ["write_file", "edit_own_file"] },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const content = (request.args.content ?? request.args.new_content ?? "") as string;
      if (!content || content.length < 20) return null;

      // Check for prohibited URLs in file content
      for (const { pattern, description } of PROHIBITED_URL_PATTERNS) {
        if (pattern.test(content)) {
          return deny(
            "eu_compliance.prohibited_content",
            "EU_PROHIBITED_CONTENT",
            `Blocked: File contains reference to ${description}. Cannot create code interacting with prohibited platforms.`,
          );
        }
      }

      // Check for prohibited activity code patterns
      for (const { pattern, description } of PROHIBITED_ACTIVITY_PATTERNS) {
        if (pattern.test(content)) {
          return deny(
            "eu_compliance.prohibited_content",
            "EU_PROHIBITED_CONTENT",
            `Blocked: File contains ${description}. This activity is prohibited under EU regulations.`,
          );
        }
      }

      return null;
    },
  };
}

/**
 * Enforce EU AI Act transparency requirements.
 * Any external-facing communication must not hide AI nature.
 * Blocks attempts to claim human identity in messages.
 */
function createAiTransparencyRule(): PolicyRule {
  return {
    id: "eu_compliance.ai_transparency",
    description: "Enforce EU AI Act transparency — agent must not deny being an AI in external communications",
    priority: 200,
    appliesTo: { by: "name", names: ["send_message", "expose_port"] },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      // For messages: check content for human-impersonation
      const content = (request.args.content ?? request.args.message ?? "") as string;
      if (!content) return null;

      const humanClaims = /\b(i am (?:a |an )?human|i(?:'m| am) not (?:a |an )?(?:ai|robot|bot|machine)|real person|flesh and blood)\b/i;
      if (humanClaims.test(content)) {
        return deny(
          "eu_compliance.ai_transparency",
          "EU_AI_ACT_TRANSPARENCY",
          `Blocked: EU AI Act (Art. 50) requires AI systems to disclose their artificial nature. Messages claiming to be human are prohibited.`,
        );
      }

      return null;
    },
  };
}

/**
 * Block GDPR-violating data collection activities.
 * Prevents the agent from scraping, storing, or processing personal data
 * without a lawful basis.
 */
function createGdprProtectionRule(): PolicyRule {
  return {
    id: "eu_compliance.gdpr_protection",
    description: "Block personal data scraping and unauthorized processing (GDPR)",
    priority: 200,
    appliesTo: { by: "name", names: ["exec", "write_file"] },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const command = (request.args.command ?? request.args.content ?? "") as string;
      if (!command) return null;

      // Block mass personal data scraping tools
      const scrapingPatterns = /\b(scrape.*email|harvest.*email|scrape.*phone|scrape.*personal|linkedin.*scraper|facebook.*scraper|social.*scraper|data.*broker)\b/i;
      if (scrapingPatterns.test(command)) {
        return deny(
          "eu_compliance.gdpr_protection",
          "EU_GDPR_VIOLATION",
          `Blocked: Mass personal data scraping/harvesting violates GDPR (Art. 5-6). No lawful basis for this processing.`,
        );
      }

      return null;
    },
  };
}

/**
 * Block interaction with EU-sanctioned entities and services.
 * Enforces EU restrictive measures (sanctions).
 */
function createSanctionsComplianceRule(): PolicyRule {
  return {
    id: "eu_compliance.sanctions",
    description: "Block interaction with EU-sanctioned services",
    priority: 100, // Highest priority — sanctions override everything
    appliesTo: { by: "all" },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      // Check all string args for sanctioned services
      const allArgs = JSON.stringify(request.args).toLowerCase();

      const sanctionedPatterns = [
        { pattern: /tornado\.?cash/i, entity: "Tornado Cash (EU/OFAC sanctioned)" },
        { pattern: /blender\.io/i, entity: "Blender.io (OFAC sanctioned mixer)" },
        { pattern: /garantex/i, entity: "Garantex (EU sanctioned exchange)" },
      ];

      for (const { pattern, entity } of sanctionedPatterns) {
        if (pattern.test(allArgs)) {
          return deny(
            "eu_compliance.sanctions",
            "EU_SANCTIONS_VIOLATION",
            `Blocked: ${entity}. Interaction violates EU restrictive measures (Council Regulation (EU) 269/2014 and related).`,
          );
        }
      }

      return null;
    },
  };
}

// ─── Export ───────────────────────────────────────────────────────

/**
 * Create all EU compliance policy rules.
 * These rules are mandatory and cannot be disabled.
 */
export function createEuComplianceRules(): PolicyRule[] {
  return [
    createSanctionsComplianceRule(),
    createProhibitedDomainRule(),
    createProhibitedActivityRule(),
    createProhibitedContentRule(),
    createAiTransparencyRule(),
    createGdprProtectionRule(),
  ];
}
