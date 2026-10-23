import { redirect } from "next/navigation";

/** The evidence protocol binds the actual pathname /ops. Keep deep links on that path. */
export default function RecipeQualificationPage() {
  redirect("/ops?view=web-recipes");
}
