import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function Home() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  } else if (session.role === "admin") {
    redirect("/admin");
  } else {
    redirect("/my");
  }
}
