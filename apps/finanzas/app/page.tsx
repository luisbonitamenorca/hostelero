import { redirect } from "next/navigation";

export default function Inicio() {
  // El middleware ya ha comprobado la sesión: aquí solo se entra con ella.
  redirect("/panel");
}
