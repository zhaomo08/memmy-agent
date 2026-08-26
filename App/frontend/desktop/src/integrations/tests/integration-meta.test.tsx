import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CATEGORY_TABS,
  GenericIntegrationIcon,
  IntegrationLogoBadge,
  composioLogoUrl,
  getAllIntegrationMeta,
  getIntegrationMeta,
  guessIntegrationCategory
} from "../integration-meta.js";
import { MANAGED_INTEGRATION_TOOLKITS } from "../toolkit-catalog.js";

describe("integrationMeta", () => {
  it("只包含 managed-auth 集成表", () => {
    expect(MANAGED_INTEGRATION_TOOLKITS).toHaveLength(118);
    expect(getAllIntegrationMeta()).toHaveLength(118);
    expect(getIntegrationMeta("github")?.name).toBe("GitHub");
  });

  it("使用 Composio 远程 logo CDN", () => {
    const html = renderToString(<IntegrationLogoBadge slug="github" name="GitHub" />);

    expect(composioLogoUrl("github")).toBe("https://logos.composio.dev/api/github");
    expect(html).toContain("https://logos.composio.dev/api/github");
    expect(html).toContain("integration-logo-badge");
    expect(html).toContain("integration-logo-image");
  });

  it("Discord 集成使用 Composio logo", () => {
    const integrationHtml = renderToString(<IntegrationLogoBadge slug="discord" name="Discord" surface="integration" />);

    expect(integrationHtml).toContain("https://logos.composio.dev/api/discord");
    expect(integrationHtml).not.toContain("channel-integration-icon-badge");
  });

  it("logo 加载失败时可渲染通用兜底图标", () => {
    expect(renderToString(<GenericIntegrationIcon name="Unknown" />)).toContain("generic-integration-icon");
  });

  it("按类别组织方式映射代表 slug", () => {
    expect(CATEGORY_TABS).toEqual(["All", "Chat", "Productivity", "Tools & Automation", "Social", "Platform"]);
    expect(guessIntegrationCategory("slack", "Slack")).toBe("Chat");
    expect(guessIntegrationCategory("googledocs", "Google Docs")).toBe("Productivity");
    expect(guessIntegrationCategory("github", "GitHub")).toBe("Platform");
    expect(guessIntegrationCategory("instagram", "Instagram")).toBe("Social");
  });
});
