import { KeyRound } from "lucide-react";
import { AccessHelpPage } from "@/components/auth/access-help-page";

export default function ForgotPasswordPage() {
  return (
    <AccessHelpPage
      icon={KeyRound}
      title="Reset Password"
      description="The current password is the value configured for this dashboard."
      items={[
        {
          title: "Reset the local password",
          body: (
            <>
              Change <code className="font-mono text-foreground">APP_PASSWORD</code> in the project{" "}
              <code className="font-mono text-foreground">.env</code> file, then restart the
              development server.
            </>
          ),
        },
        {
          title: "Sign out every active session",
          body: (
            <>
              Change <code className="font-mono text-foreground">AUTH_SECRET</code> as well if all
              existing browser sessions should be invalidated.
            </>
          ),
        },
        {
          title: "Reset a deployed app",
          body:
            "Update the same environment variables in the hosting dashboard and redeploy or restart the app.",
        },
      ]}
      note="A one-click email reset link needs an email provider and reset-token storage, which this app has not implemented yet."
    />
  );
}
