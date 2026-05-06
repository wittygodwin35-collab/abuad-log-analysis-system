import { UserPlus } from "lucide-react";
import { AccessHelpPage } from "@/components/auth/access-help-page";

export default function SignupPage() {
  return (
    <AccessHelpPage
      icon={UserPlus}
      title="Request Access"
      description="Access is managed through the app's configured dashboard credentials."
      items={[
        {
          title: "Account creation is administrator-managed",
          body:
            "This build does not keep a database of users, so it cannot safely create public self-service accounts yet.",
        },
        {
          title: "For local development",
          body: (
            <>
              Set <code className="font-mono text-foreground">APP_USERNAME</code> and{" "}
              <code className="font-mono text-foreground">APP_PASSWORD</code> in the project{" "}
              <code className="font-mono text-foreground">.env</code> file, then restart the
              development server.
            </>
          ),
        },
        {
          title: "For deployed access",
          body:
            "Ask the project owner to add or share the dashboard credentials from the hosting environment settings.",
        },
      ]}
      note="A real sign-up flow should add a user table, password hashing, role policy, and email verification before accepting new accounts."
    />
  );
}
