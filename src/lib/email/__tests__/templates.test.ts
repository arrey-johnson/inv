import { describe, expect, it } from "vitest";
import { buildDocumentEmail, escapeHtml } from "../templates";

describe("email templates", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<script>alert("x")&'`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;");
  });

  it("builds subject, text and html with escaped customer data", () => {
    const mail = buildDocumentEmail({
      documentLabel: "Invoice",
      number: "PS-INV-2026-0001",
      customerName: `<b>Evil</b> & Co`,
      companyName: "Promptstack Technologies",
      total: 1_192_500,
      currency: "XAF",
      dueDate: "2026-11-01",
      publicUrl: "https://example.com/document/abc",
      message: "Thanks <3",
    });
    expect(mail.subject).toBe("Invoice PS-INV-2026-0001 from Promptstack Technologies");
    expect(mail.text).toContain("1,192,500 FCFA");
    expect(mail.html).not.toContain("<b>Evil</b>");
    expect(mail.html).toContain("&lt;b&gt;Evil&lt;/b&gt; &amp; Co");
    expect(mail.html).toContain("Thanks &lt;3");
    expect(mail.html).toContain("https://example.com/document/abc");
  });
});
