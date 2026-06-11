import type { ISODateTime } from "./models"

export interface MobileAppConfig {
  allowMobileSignup: boolean
  privacyPolicyPath: string
  privacyPolicyUrl?: string
  privacyPolicyTitle: string
  privacyPolicyContent: string
  termsOfServicePath: string
  termsOfServiceUrl?: string
  termsOfServiceTitle: string
  termsOfServiceContent: string
  updatedAt: ISODateTime
}

export const defaultMobileAppConfig = (): MobileAppConfig => ({
  allowMobileSignup: false,
  privacyPolicyPath: "/privacy",
  privacyPolicyUrl: "",
  privacyPolicyTitle: "Privacy Policy",
  privacyPolicyContent: `<h2>Privacy Policy</h2>
<p><strong>YOUR HOME GROUP Consultancy</strong> ("YHGC", "we", "us") respects your privacy.</p>
<ul>
  <li>We collect the information you provide when creating a client account (name, email, and login credentials).</li>
  <li>We process portfolio data shared by your adviser to operate the YHGC client app.</li>
  <li>We use push notifications only for portfolio updates you are entitled to receive.</li>
  <li>We do not sell your personal data.</li>
</ul>
<p>Contact <a href="mailto:admin@yourhomegroupconsultancy.co.uk">admin@yourhomegroupconsultancy.co.uk</a> for privacy requests.</p>`,
  termsOfServicePath: "/terms",
  termsOfServiceUrl: "",
  termsOfServiceTitle: "Terms of Service",
  termsOfServiceContent: `<h2>Terms of Service</h2>
<p>By using the YHGC client application you agree to these terms.</p>
<ul>
  <li>The app provides access to property portfolio information prepared by YOUR HOME GROUP Consultancy.</li>
  <li>You are responsible for keeping your password confidential.</li>
  <li>Portfolio figures and documents are provided for information; confirm important decisions with your adviser.</li>
  <li>We may suspend access for security, non-payment, or breach of these terms.</li>
</ul>
<p>YHGC may update these terms; continued use after notice constitutes acceptance.</p>`,
  updatedAt: new Date().toISOString(),
})
