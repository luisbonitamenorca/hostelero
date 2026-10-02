"use client";

/* Ajustes › Usuarios y permisos (reservas_permisos_perfil). Una fila por usuario de la cuenta con
   lo que puede hacer en Reservas. Sin fila = permisos por defecto (todo salvo cobrar, editar el
   plano y ajustes). Dirección lo puede todo siempre y es la única que edita esta pantalla. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { guardarPermiso, listarPermisos, restablecerPermiso, type CamposPermiso, type Permiso, type PerfilMin } from "../../acciones/ajustes";
import { Boton, Cabecera, Chip, Confirmar, Interruptor, Vacio, useAccion, type AjProps } from "./comunes";

type Clave = "puede_cambiar_estado" | "puede_mover" | "puede_cobrar" | "puede_editar_plano" | "puede_ajustes";

/* Dónde se aplica cada permiso hoy (para no prometer lo que no ocurre):
   - Estados y Mover: acciones/dia.ts (Día). El cronograma y el modal de la reserva aún no los miran.
   - Cobrar: sin efecto; acciones/pagos.ts solo deja cobrar a dirección. Se desactiva hasta cablearlo.
   - Plano: acciones/plano.ts. Ajustes: acciones/ajustes.ts (también por restaurante).
   - Restaurantes: Día y Ajustes. */
const COLUMNAS: { clave: Clave; texto: string; ayuda: string; parcial?: string; noAplica?: string }[] = [
  { clave: "puede_cambiar_estado", texto: "Estados", ayuda: "Sentar, confirmar, marcar no-show o cancelar reservas.", parcial: "Se aplica en Día; el cronograma y la ficha de la reserva aún no lo comprueban." },
  { clave: "puede_mover", texto: "Mover", ayuda: "Cambiar de mesa, de hora o de día una reserva (arrastrar en el plano).", parcial: "Se aplica en Día; arrastrar en el cronograma aún no lo comprueba." },
  { clave: "puede_cobrar", texto: "Cobrar", ayuda: "Cobrar garantías, prepagos y cargos por no-show, y devolver.", noAplica: "Aún no se aplica: de momento solo dirección puede cobrar y devolver." },
  { clave: "puede_editar_plano", texto: "Plano", ayuda: "Mover mesas y objetos en el editor del plano (Salas y planos)." },
  { clave: "puede_ajustes", texto: "Ajustes", ayuda: "Cambiar la configuración de Reservas (todo salvo esta pantalla). Con restaurantes limitados, solo los de esos locales; lo común a todos (etiquetas, prescriptores, mensajes y códigos de la cuenta) exige todos los restaurantes." },
];
const AVISO_RESTAURANTES = "Se aplica en Día y en Ajustes; el cronograma y la ficha de la reserva aún no lo comprueban.";

/** Lo que tiene alguien sin fila propia (mismo criterio que los defaults de la tabla). */
const DEFECTO: CamposPermiso = { puede_cobrar: false, puede_mover: true, puede_cambiar_estado: true, puede_editar_plano: false, puede_ajustes: false, restaurantes: null };

const ROLES: Record<string, string> = {
  direccion: "Dirección",
  responsable_area: "Responsable de área",
  jefe_sala: "Jefe de sala",
  administracion: "Administración",
  empleado: "Empleado",
};
/** Roles que traen Reservas de serie (lib/supabase/server › ACCESO_POR_ROL). El resto solo entra con concesión. */
const ROLES_CON_RESERVAS = new Set(["direccion", "responsable_area", "jefe_sala"]);

const camposDe = (p: Permiso | undefined): CamposPermiso =>
  p
    ? { puede_cobrar: p.puede_cobrar, puede_mover: p.puede_mover, puede_cambiar_estado: p.puede_cambiar_estado, puede_editar_plano: p.puede_editar_plano, puede_ajustes: p.puede_ajustes, restaurantes: p.restaurantes }
    : DEFECTO;

export default function AjPermisos({ ctx, avisar, esDireccion }: AjProps) {
  const [perfiles, setPerfiles] = useState<PerfilMin[] | null>(null);
  const [permisos, setPermisos] = useState<Permiso[]>([]);
  const [soloLectura, setSoloLectura] = useState(true);
  const [verTodos, setVerTodos] = useState(false);
  const [restablecer, setRestablecer] = useState<PerfilMin | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const { ocupado, correr } = useAccion(avisar);
  const ro = soloLectura || !esDireccion;

  const cargar = useCallback(async () => {
    const r = await listarPermisos();
    setPerfiles(r.perfiles);
    setPermisos(r.permisos);
    setSoloLectura(r.soloLectura);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const porPerfil = useMemo(() => new Map(permisos.map((p) => [p.perfil_id, p])), [permisos]);
  const rests = ctx.restaurantes;

  const visibles = useMemo(() => {
    const l = (perfiles ?? []).filter((p) => verTodos || ROLES_CON_RESERVAS.has(p.rol) || porPerfil.has(p.id));
    // Dirección arriba; luego por nombre.
    return l.sort((a, b) => (a.rol === "direccion" ? 0 : 1) - (b.rol === "direccion" ? 0 : 1) || (a.nombre || a.correo).localeCompare(b.nombre || b.correo, "es"));
  }, [perfiles, verTodos, porPerfil]);
  const ocultos = (perfiles?.length ?? 0) - visibles.length;

  /** Guarda la fila completa con un cambio aplicado; actualiza en optimista y deshace si falla. */
  async function cambiar(p: PerfilMin, cambio: Partial<CamposPermiso>) {
    if (ro) return;
    const previo = porPerfil.get(p.id);
    const nuevo: CamposPermiso = { ...camposDe(previo), ...cambio };
    setGuardando(p.id);
    const r = await correr(guardarPermiso(p.id, nuevo));
    setGuardando(null);
    if (r.ok && r.data) {
      const fila = r.data;
      setPermisos((l) => [...l.filter((x) => x.perfil_id !== p.id), fila]);
    }
  }

  /** Restaurantes: null = todos. Pulsar uno con «todos» activo restringe a los demás. */
  function alternarRest(p: PerfilMin, restId: string) {
    const actual = camposDe(porPerfil.get(p.id)).restaurantes;
    const base = actual && actual.length ? actual : rests.map((r) => r.id);
    const sig = base.includes(restId) ? base.filter((x) => x !== restId) : [...base, restId];
    if (!sig.length) { avisar("Tiene que poder entrar al menos en un restaurante."); return; }
    cambiar(p, { restaurantes: sig.length >= rests.length && rests.every((r) => sig.includes(r.id)) ? null : sig });
  }

  if (!esDireccion) {
    return (
      <>
        <Cabecera titulo="Usuarios y permisos" />
        <div className="aj-aviso">Solo dirección puede ver y cambiar los permisos de Reservas.</div>
      </>
    );
  }

  return (
    <>
      <Cabecera
        titulo="Usuarios y permisos"
        texto="Qué puede hacer cada persona en Reservas. Quien no tiene permisos propios usa los de por defecto: cambiar estados y mover reservas sí; cobrar, editar el plano y ajustes no. Dirección puede siempre todo. Las marcas en ámbar indican dónde aún no se comprueba un permiso."
      >
        <Interruptor on={verTodos} onChange={setVerTodos} pequeno texto="Ver también usuarios sin Reservas" />
      </Cabecera>
      {ro ? <div className="aj-aviso">Solo lectura.</div> : null}

      {perfiles === null ? (
        <div className="spinner" />
      ) : !perfiles.length ? (
        <Vacio>No se han podido leer los usuarios de la cuenta.</Vacio>
      ) : (
        <div className="aj-tabla-env">
          <table className="aj-tabla">
            <thead>
              <tr>
                <th>Usuario</th>
                {COLUMNAS.map((c) => (
                  <th key={c.clave} className="centro" title={c.noAplica ?? c.parcial ?? c.ayuda}>
                    {c.texto}
                    {c.noAplica ? <span className="aj-perm-pend">aún no se aplica</span> : c.parcial ? <span className="aj-perm-pend">solo en Día</span> : null}
                  </th>
                ))}
                {rests.length > 1 ? <th title={AVISO_RESTAURANTES}>Restaurantes<span className="aj-perm-pend">Día y Ajustes</span></th> : null}
                <th className="acc" />
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => {
                const dir = p.rol === "direccion";
                const fila = porPerfil.get(p.id);
                const c = camposDe(fila);
                const sinModulo = !ROLES_CON_RESERVAS.has(p.rol);
                const bloqueado = ro || dir || guardando === p.id;
                return (
                  <tr key={p.id}>
                    <td className="nombre">
                      {p.nombre || p.correo}
                      {p.id === ctx.userId ? <span className="mudo" style={{ fontWeight: 400 }}> · tú</span> : null}
                      <span className="det">
                        <span className="aj-rol">{ROLES[p.rol] ?? p.rol}</span>
                        {p.nombre ? ` · ${p.correo}` : ""}
                        {sinModulo ? " · sin Reservas por su rol" : ""}
                      </span>
                    </td>
                    {COLUMNAS.map((col) => (
                      <td key={col.clave} className={`centro${col.noAplica && !dir ? " no-aplica" : ""}`} title={col.noAplica ?? col.ayuda}>
                        <Interruptor pequeno on={dir || c[col.clave]} disabled={bloqueado || !!col.noAplica} onChange={(v) => cambiar(p, { [col.clave]: v })} />
                      </td>
                    ))}
                    {rests.length > 1 ? (
                      <td>
                        {dir ? (
                          <span className="mudo">todos</span>
                        ) : (
                          <div className="aj-perm-rests">
                            {rests.map((r) => {
                              const on = !c.restaurantes || c.restaurantes.includes(r.id);
                              return (
                                <label key={r.id} className={on ? "on" : ""} title={on ? "Puede trabajar en este restaurante" : "No ve este restaurante"}>
                                  <input type="checkbox" checked={on} disabled={bloqueado} onChange={() => alternarRest(p, r.id)} />
                                  {r.nombre}
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    ) : null}
                    <td className="acc">
                      {dir ? (
                        <Chip color="#0F6E56">todo</Chip>
                      ) : fila ? (
                        <>
                          <Chip color="#D99A1E" title="Tiene permisos propios">propios</Chip>
                          {!ro ? <Boton className="mini" tipo="fantasma" onClick={() => setRestablecer(p)} title="Volver a los permisos por defecto">Restablecer</Boton> : null}
                        </>
                      ) : (
                        <Chip color="#8A9199" title="Usa los permisos por defecto">por defecto</Chip>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!visibles.length ? (
                <tr><td colSpan={COLUMNAS.length + 3}><Vacio>No hay usuarios con acceso a Reservas.</Vacio></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      {ocultos > 0 && !verTodos ? (
        <p className="aj-ayuda">{ocultos === 1 ? "Hay 1 usuario más" : `Hay ${ocultos} usuarios más`} cuyo rol no incluye Reservas. Para darles acceso al módulo, usa Usuarios en la configuración general.</p>
      ) : null}

      <div className="aj-panel" style={{ marginTop: 12 }}>
        <div className="aj-panel-cab"><h3>Qué permite cada columna</h3></div>
        <ul className="aj-ayuda" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 3 }}>
          {COLUMNAS.map((c) => (
            <li key={c.clave}>
              <b>{c.texto}:</b> {c.ayuda}
              {c.noAplica ? <span className="aj-perm-pend" style={{ display: "inline", marginLeft: 6 }}>{c.noAplica}</span> : c.parcial ? <span className="aj-perm-pend" style={{ display: "inline", marginLeft: 6 }}>{c.parcial}</span> : null}
            </li>
          ))}
          {rests.length > 1 ? (
            <li>
              <b>Restaurantes:</b> en cuáles puede trabajar. Todos marcados = todos (también los que se abran después).
              <span className="aj-perm-pend" style={{ display: "inline", marginLeft: 6 }}>{AVISO_RESTAURANTES}</span>
            </li>
          ) : null}
        </ul>
      </div>

      {restablecer ? (
        <Confirmar
          texto={`¿Volver a los permisos por defecto para ${restablecer.nombre || restablecer.correo}?`}
          detalle="Podrá cambiar estados y mover reservas, pero no cobrar, editar el plano ni tocar ajustes."
          confirmarTexto="Restablecer"
          ocupado={ocupado}
          onNo={() => setRestablecer(null)}
          onSi={async () => {
            const id = restablecer.id;
            const r = await correr(restablecerPermiso(id), "Permisos restablecidos.");
            setRestablecer(null);
            if (r.ok) setPermisos((l) => l.filter((x) => x.perfil_id !== id));
          }}
        />
      ) : null}
    </>
  );
}
