import { redirect } from "next/navigation";

export default function HomePage() {
  // The authenticated app lives under /dashboard; middleware sends signed-out users to /login.
  redirect("/dashboard");
}
