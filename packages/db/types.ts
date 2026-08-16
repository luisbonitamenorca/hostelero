export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accesos_soporte: {
        Row: {
          creado_en: string
          cuenta_id: string
          id: string
          motivo: string
          operador_id: string
        }
        Insert: {
          creado_en?: string
          cuenta_id: string
          id?: string
          motivo: string
          operador_id: string
        }
        Update: {
          creado_en?: string
          cuenta_id?: string
          id?: string
          motivo?: string
          operador_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accesos_soporte_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accesos_soporte_operador_id_fkey"
            columns: ["operador_id"]
            isOneToOne: false
            referencedRelation: "operadores"
            referencedColumns: ["id"]
          },
        ]
      }
      agentes_activos: {
        Row: {
          activo: boolean
          agente_id: string
          config: Json
          creado_en: string
          cuenta_id: string
        }
        Insert: {
          activo?: boolean
          agente_id: string
          config?: Json
          creado_en?: string
          cuenta_id: string
        }
        Update: {
          activo?: boolean
          agente_id?: string
          config?: Json
          creado_en?: string
          cuenta_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agentes_activos_agente_id_fkey"
            columns: ["agente_id"]
            isOneToOne: false
            referencedRelation: "agentes_catalogo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agentes_activos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      agentes_catalogo: {
        Row: {
          ambito: string
          descripcion: string
          estado: string
          id: string
          nombre: string
          orden: number
          usa_web: boolean
        }
        Insert: {
          ambito?: string
          descripcion?: string
          estado?: string
          id: string
          nombre: string
          orden?: number
          usa_web?: boolean
        }
        Update: {
          ambito?: string
          descripcion?: string
          estado?: string
          id?: string
          nombre?: string
          orden?: number
          usa_web?: boolean
        }
        Relationships: []
      }
      agentes_competidores: {
        Row: {
          activo: boolean
          ambito: string
          creado_en: string
          cuenta_id: string
          id: string
          nombre: string
          notas: string | null
          ultima_revision: string | null
          web: string | null
        }
        Insert: {
          activo?: boolean
          ambito?: string
          creado_en?: string
          cuenta_id: string
          id?: string
          nombre: string
          notas?: string | null
          ultima_revision?: string | null
          web?: string | null
        }
        Update: {
          activo?: boolean
          ambito?: string
          creado_en?: string
          cuenta_id?: string
          id?: string
          nombre?: string
          notas?: string | null
          ultima_revision?: string | null
          web?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agentes_competidores_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      agentes_conocimiento: {
        Row: {
          activo: boolean
          actualizado_en: string
          centro_id: string
          contenido: string
          cuenta_id: string
          id: string
          origen: string
          titulo: string
        }
        Insert: {
          activo?: boolean
          actualizado_en?: string
          centro_id: string
          contenido?: string
          cuenta_id: string
          id?: string
          origen?: string
          titulo: string
        }
        Update: {
          activo?: boolean
          actualizado_en?: string
          centro_id?: string
          contenido?: string
          cuenta_id?: string
          id?: string
          origen?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "agentes_conocimiento_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agentes_conocimiento_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      agentes_hallazgos: {
        Row: {
          competidor_id: string
          creado_en: string
          cuenta_id: string
          detalle: string | null
          estado: string
          id: string
          relevancia: number | null
          tipo: string
          titulo: string
          url: string | null
        }
        Insert: {
          competidor_id: string
          creado_en?: string
          cuenta_id: string
          detalle?: string | null
          estado?: string
          id?: string
          relevancia?: number | null
          tipo?: string
          titulo: string
          url?: string | null
        }
        Update: {
          competidor_id?: string
          creado_en?: string
          cuenta_id?: string
          detalle?: string | null
          estado?: string
          id?: string
          relevancia?: number | null
          tipo?: string
          titulo?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agentes_hallazgos_competidor_id_fkey"
            columns: ["competidor_id"]
            isOneToOne: false
            referencedRelation: "agentes_competidores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agentes_hallazgos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      agentes_perfil_subvenciones: {
        Row: {
          actualizado_en: string
          cuenta_id: string
          perfil: string
          territorio: string
        }
        Insert: {
          actualizado_en?: string
          cuenta_id: string
          perfil?: string
          territorio?: string
        }
        Update: {
          actualizado_en?: string
          cuenta_id?: string
          perfil?: string
          territorio?: string
        }
        Relationships: [
          {
            foreignKeyName: "agentes_perfil_subvenciones_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: true
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      agentes_prospectos: {
        Row: {
          actualizado_en: string
          angulo: string | null
          ciudad: string | null
          creado_en: string
          cuenta_id: string
          email: string | null
          etapa: string
          id: string
          nombre: string
          notas: string | null
          perfil: string | null
          razon: string | null
          score: number | null
          telefono: string | null
          web: string | null
          zona: string
        }
        Insert: {
          actualizado_en?: string
          angulo?: string | null
          ciudad?: string | null
          creado_en?: string
          cuenta_id: string
          email?: string | null
          etapa?: string
          id?: string
          nombre: string
          notas?: string | null
          perfil?: string | null
          razon?: string | null
          score?: number | null
          telefono?: string | null
          web?: string | null
          zona: string
        }
        Update: {
          actualizado_en?: string
          angulo?: string | null
          ciudad?: string | null
          creado_en?: string
          cuenta_id?: string
          email?: string | null
          etapa?: string
          id?: string
          nombre?: string
          notas?: string | null
          perfil?: string | null
          razon?: string | null
          score?: number | null
          telefono?: string | null
          web?: string | null
          zona?: string
        }
        Relationships: [
          {
            foreignKeyName: "agentes_prospectos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      agentes_resenas: {
        Row: {
          actualizado_en: string
          autor: string | null
          borrador: string | null
          centro_id: string
          creado_en: string
          cuenta_id: string
          estado: string
          externo_id: string
          fecha: string | null
          id: string
          idioma: string | null
          origen: string
          plataforma: string
          texto: string
          valoracion: number | null
        }
        Insert: {
          actualizado_en?: string
          autor?: string | null
          borrador?: string | null
          centro_id: string
          creado_en?: string
          cuenta_id: string
          estado?: string
          externo_id: string
          fecha?: string | null
          id?: string
          idioma?: string | null
          origen?: string
          plataforma: string
          texto: string
          valoracion?: number | null
        }
        Update: {
          actualizado_en?: string
          autor?: string | null
          borrador?: string | null
          centro_id?: string
          creado_en?: string
          cuenta_id?: string
          estado?: string
          externo_id?: string
          fecha?: string | null
          id?: string
          idioma?: string | null
          origen?: string
          plataforma?: string
          texto?: string
          valoracion?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agentes_resenas_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agentes_resenas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      agentes_runs: {
        Row: {
          agente_id: string
          busquedas: number
          centro_id: string | null
          coste: number
          cuenta_id: string
          duracion_ms: number | null
          error: string | null
          id: string
          items: number
          ok: boolean
          tokens_in: number
          tokens_out: number
          ts: string
        }
        Insert: {
          agente_id: string
          busquedas?: number
          centro_id?: string | null
          coste?: number
          cuenta_id: string
          duracion_ms?: number | null
          error?: string | null
          id?: string
          items?: number
          ok?: boolean
          tokens_in?: number
          tokens_out?: number
          ts?: string
        }
        Update: {
          agente_id?: string
          busquedas?: number
          centro_id?: string | null
          coste?: number
          cuenta_id?: string
          duracion_ms?: number | null
          error?: string | null
          id?: string
          items?: number
          ok?: boolean
          tokens_in?: number
          tokens_out?: number
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "agentes_runs_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agentes_runs_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      agentes_subvenciones: {
        Row: {
          actualizado_en: string
          ambito: string
          bdns: string | null
          creado_en: string
          cuenta_id: string
          detalle: string | null
          encaje: number | null
          estado: string
          fecha_pub: string | null
          fuente: string
          id: string
          importe: string | null
          materia: string | null
          notas: string | null
          organo: string | null
          plazo: string | null
          razon: string | null
          titulo: string
          url: string | null
        }
        Insert: {
          actualizado_en?: string
          ambito?: string
          bdns?: string | null
          creado_en?: string
          cuenta_id: string
          detalle?: string | null
          encaje?: number | null
          estado?: string
          fecha_pub?: string | null
          fuente?: string
          id?: string
          importe?: string | null
          materia?: string | null
          notas?: string | null
          organo?: string | null
          plazo?: string | null
          razon?: string | null
          titulo: string
          url?: string | null
        }
        Update: {
          actualizado_en?: string
          ambito?: string
          bdns?: string | null
          creado_en?: string
          cuenta_id?: string
          detalle?: string | null
          encaje?: number | null
          estado?: string
          fecha_pub?: string | null
          fuente?: string
          id?: string
          importe?: string | null
          materia?: string | null
          notas?: string | null
          organo?: string | null
          plazo?: string | null
          razon?: string | null
          titulo?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agentes_subvenciones_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      agentes_sync_alertas: {
        Row: {
          centro_id: string
          creado_en: string
          cuenta_id: string
          detalle: string | null
          encontrado: string | null
          esperado: string | null
          estado: string
          id: string
          plataforma: Database["public"]["Enums"]["agentes_plataforma"]
          resuelto_en: string | null
        }
        Insert: {
          centro_id: string
          creado_en?: string
          cuenta_id: string
          detalle?: string | null
          encontrado?: string | null
          esperado?: string | null
          estado?: string
          id?: string
          plataforma: Database["public"]["Enums"]["agentes_plataforma"]
          resuelto_en?: string | null
        }
        Update: {
          centro_id?: string
          creado_en?: string
          cuenta_id?: string
          detalle?: string | null
          encontrado?: string | null
          esperado?: string | null
          estado?: string
          id?: string
          plataforma?: Database["public"]["Enums"]["agentes_plataforma"]
          resuelto_en?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agentes_sync_alertas_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agentes_sync_alertas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      agentes_sync_checks: {
        Row: {
          centro_id: string
          comprobadas: number
          creado_en: string
          cuenta_id: string
          discrepancias: number
          id: string
          ok: boolean
          resumen: string | null
        }
        Insert: {
          centro_id: string
          comprobadas?: number
          creado_en?: string
          cuenta_id: string
          discrepancias?: number
          id?: string
          ok: boolean
          resumen?: string | null
        }
        Update: {
          centro_id?: string
          comprobadas?: number
          creado_en?: string
          cuenta_id?: string
          discrepancias?: number
          id?: string
          ok?: boolean
          resumen?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agentes_sync_checks_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agentes_sync_checks_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      agentes_tonos: {
        Row: {
          actualizado_en: string
          centro_id: string
          cuenta_id: string
          id: string
          orden: number
          tono: string
        }
        Insert: {
          actualizado_en?: string
          centro_id: string
          cuenta_id: string
          id?: string
          orden?: number
          tono?: string
        }
        Update: {
          actualizado_en?: string
          centro_id?: string
          cuenta_id?: string
          id?: string
          orden?: number
          tono?: string
        }
        Relationships: [
          {
            foreignKeyName: "agentes_tonos_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agentes_tonos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      agentes_wa_chats: {
        Row: {
          centro_id: string
          cliente: string
          creado_en: string
          cuenta_id: string
          estado: string
          externo_id: string | null
          id: string
          origen: string
          telefono_mask: string | null
          ultimo_ts: string
        }
        Insert: {
          centro_id: string
          cliente: string
          creado_en?: string
          cuenta_id: string
          estado?: string
          externo_id?: string | null
          id?: string
          origen?: string
          telefono_mask?: string | null
          ultimo_ts?: string
        }
        Update: {
          centro_id?: string
          cliente?: string
          creado_en?: string
          cuenta_id?: string
          estado?: string
          externo_id?: string | null
          id?: string
          origen?: string
          telefono_mask?: string | null
          ultimo_ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "agentes_wa_chats_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agentes_wa_chats_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      agentes_wa_mensajes: {
        Row: {
          chat_id: string
          cuenta_id: string
          emisor: string
          id: string
          texto: string
          ts: string
        }
        Insert: {
          chat_id: string
          cuenta_id: string
          emisor: string
          id?: string
          texto: string
          ts?: string
        }
        Update: {
          chat_id?: string
          cuenta_id?: string
          emisor?: string
          id?: string
          texto?: string
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "agentes_wa_mensajes_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "agentes_wa_chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agentes_wa_mensajes_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      centros: {
        Row: {
          creado_en: string
          cuenta_id: string
          direccion: string | null
          email: string | null
          id: string
          lat: number | null
          lng: number | null
          nombre: string
          observaciones: string | null
          persona_contacto: string | null
          sociedad_id: string
          telefono: string | null
        }
        Insert: {
          creado_en?: string
          cuenta_id: string
          direccion?: string | null
          email?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          nombre: string
          observaciones?: string | null
          persona_contacto?: string | null
          sociedad_id: string
          telefono?: string | null
        }
        Update: {
          creado_en?: string
          cuenta_id?: string
          direccion?: string | null
          email?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          nombre?: string
          observaciones?: string | null
          persona_contacto?: string | null
          sociedad_id?: string
          telefono?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "centros_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "centros_sociedad_id_cuenta_id_fkey"
            columns: ["sociedad_id", "cuenta_id"]
            isOneToOne: false
            referencedRelation: "sociedades"
            referencedColumns: ["id", "cuenta_id"]
          },
        ]
      }
      centros_departamentos: {
        Row: {
          centro_id: string
          cuenta_id: string
          departamento_id: string
        }
        Insert: {
          centro_id: string
          cuenta_id?: string
          departamento_id: string
        }
        Update: {
          centro_id?: string
          cuenta_id?: string
          departamento_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "centros_departamentos_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "centros_departamentos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "centros_departamentos_departamento_id_fkey"
            columns: ["departamento_id"]
            isOneToOne: false
            referencedRelation: "departamentos"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          actualizado_en: string
          apellidos: string | null
          atributos: Json
          creado_en: string
          cuenta_id: string
          cumpleanos: string | null
          email: string | null
          email_norm: string | null
          id: string
          idioma: string | null
          nombre: string | null
          notas: string | null
          origen_alta: string
          telefono: string | null
          telefono_norm: string | null
          vip: boolean
        }
        Insert: {
          actualizado_en?: string
          apellidos?: string | null
          atributos?: Json
          creado_en?: string
          cuenta_id?: string
          cumpleanos?: string | null
          email?: string | null
          email_norm?: string | null
          id?: string
          idioma?: string | null
          nombre?: string | null
          notas?: string | null
          origen_alta?: string
          telefono?: string | null
          telefono_norm?: string | null
          vip?: boolean
        }
        Update: {
          actualizado_en?: string
          apellidos?: string | null
          atributos?: Json
          creado_en?: string
          cuenta_id?: string
          cumpleanos?: string | null
          email?: string | null
          email_norm?: string | null
          id?: string
          idioma?: string | null
          nombre?: string | null
          notas?: string | null
          origen_alta?: string
          telefono?: string | null
          telefono_norm?: string | null
          vip?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "clientes_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes_origenes: {
        Row: {
          cliente_id: string
          creado_en: string
          cuenta_id: string
          datos: Json | null
          id: string
          id_externo: string | null
          origen: string
        }
        Insert: {
          cliente_id: string
          creado_en?: string
          cuenta_id?: string
          datos?: Json | null
          id?: string
          id_externo?: string | null
          origen: string
        }
        Update: {
          cliente_id?: string
          creado_en?: string
          cuenta_id?: string
          datos?: Json | null
          id?: string
          id_externo?: string | null
          origen?: string
        }
        Relationships: [
          {
            foreignKeyName: "clientes_origenes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_origenes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes_consentimiento_vigente"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "clientes_origenes_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      compras_correo: {
        Row: {
          asunto: string | null
          created_at: string | null
          cuenta_id: string
          fecha_correo: string | null
          id: number
          message_id: string
          num_adjuntos: number | null
          remitente: string | null
        }
        Insert: {
          asunto?: string | null
          created_at?: string | null
          cuenta_id?: string
          fecha_correo?: string | null
          id?: number
          message_id: string
          num_adjuntos?: number | null
          remitente?: string | null
        }
        Update: {
          asunto?: string | null
          created_at?: string | null
          cuenta_id?: string
          fecha_correo?: string | null
          id?: number
          message_id?: string
          num_adjuntos?: number | null
          remitente?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compras_correo_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      compras_correo_adjunto: {
        Row: {
          claimed_at: string | null
          correo_id: number | null
          created_at: string | null
          cuenta_id: string
          doc_id: string | null
          error: string | null
          estado: string | null
          id: number
          mime: string | null
          nombre_archivo: string | null
          storage_path: string | null
          url: string | null
        }
        Insert: {
          claimed_at?: string | null
          correo_id?: number | null
          created_at?: string | null
          cuenta_id?: string
          doc_id?: string | null
          error?: string | null
          estado?: string | null
          id?: number
          mime?: string | null
          nombre_archivo?: string | null
          storage_path?: string | null
          url?: string | null
        }
        Update: {
          claimed_at?: string | null
          correo_id?: number | null
          created_at?: string | null
          cuenta_id?: string
          doc_id?: string | null
          error?: string | null
          estado?: string | null
          id?: number
          mime?: string | null
          nombre_archivo?: string | null
          storage_path?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compras_correo_adjunto_correo_id_fkey"
            columns: ["correo_id"]
            isOneToOne: false
            referencedRelation: "compras_correo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_correo_adjunto_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_correo_adjunto_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "compras_doc"
            referencedColumns: ["id"]
          },
        ]
      }
      compras_cuenta_a3: {
        Row: {
          activo: boolean
          contrapartida: string | null
          created_at: string
          cuenta: string
          cuenta_id: string
          nif: string | null
          nif_norm: string | null
          nombre: string
          nombre_norm: string | null
        }
        Insert: {
          activo?: boolean
          contrapartida?: string | null
          created_at?: string
          cuenta: string
          cuenta_id?: string
          nif?: string | null
          nif_norm?: string | null
          nombre: string
          nombre_norm?: string | null
        }
        Update: {
          activo?: boolean
          contrapartida?: string | null
          created_at?: string
          cuenta?: string
          cuenta_id?: string
          nif?: string | null
          nif_norm?: string | null
          nombre?: string
          nombre_norm?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compras_cuenta_a3_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      compras_doc: {
        Row: {
          albaranes_detectados: Json | null
          base: number | null
          canal: string | null
          centro_id: string | null
          created_at: string
          cuenta_id: string
          descuento: number | null
          estado: string
          estado_detalle: string | null
          factura_id: string | null
          fecha: string | null
          hash_doc: string | null
          id: string
          imagen_url: string | null
          iva: number | null
          num_documento: string | null
          origen: string | null
          proveedor: string | null
          proveedor_id: string | null
          proveedor_nif: string | null
          raw: Json | null
          tipo: string
          total: number | null
        }
        Insert: {
          albaranes_detectados?: Json | null
          base?: number | null
          canal?: string | null
          centro_id?: string | null
          created_at?: string
          cuenta_id?: string
          descuento?: number | null
          estado?: string
          estado_detalle?: string | null
          factura_id?: string | null
          fecha?: string | null
          hash_doc?: string | null
          id?: string
          imagen_url?: string | null
          iva?: number | null
          num_documento?: string | null
          origen?: string | null
          proveedor?: string | null
          proveedor_id?: string | null
          proveedor_nif?: string | null
          raw?: Json | null
          tipo?: string
          total?: number | null
        }
        Update: {
          albaranes_detectados?: Json | null
          base?: number | null
          canal?: string | null
          centro_id?: string | null
          created_at?: string
          cuenta_id?: string
          descuento?: number | null
          estado?: string
          estado_detalle?: string | null
          factura_id?: string | null
          fecha?: string | null
          hash_doc?: string | null
          id?: string
          imagen_url?: string | null
          iva?: number | null
          num_documento?: string | null
          origen?: string | null
          proveedor?: string | null
          proveedor_id?: string | null
          proveedor_nif?: string | null
          raw?: Json | null
          tipo?: string
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "compras_doc_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_doc_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_doc_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "compras_doc"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_doc_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "compras_proveedor"
            referencedColumns: ["id"]
          },
        ]
      }
      compras_linea: {
        Row: {
          canal: string | null
          cantidad: number | null
          centro_id: string | null
          created_at: string
          cuenta_id: string
          doc_id: string | null
          id: string
          id_producto: string | null
          importe: number | null
          precio_unit: number | null
          producto: string | null
          producto_id: string | null
        }
        Insert: {
          canal?: string | null
          cantidad?: number | null
          centro_id?: string | null
          created_at?: string
          cuenta_id?: string
          doc_id?: string | null
          id?: string
          id_producto?: string | null
          importe?: number | null
          precio_unit?: number | null
          producto?: string | null
          producto_id?: string | null
        }
        Update: {
          canal?: string | null
          cantidad?: number | null
          centro_id?: string | null
          created_at?: string
          cuenta_id?: string
          doc_id?: string | null
          id?: string
          id_producto?: string | null
          importe?: number | null
          precio_unit?: number | null
          producto?: string | null
          producto_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compras_linea_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_linea_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_linea_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "compras_doc"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_linea_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "compras_producto"
            referencedColumns: ["id"]
          },
        ]
      }
      compras_producto: {
        Row: {
          codigo_interno: string | null
          created_at: string
          cuenta_id: string
          id: string
          nombre: string | null
          proveedor_id: string | null
          proveedor_nombre: string | null
          ref_proveedor: string | null
          ultimo_precio: number | null
        }
        Insert: {
          codigo_interno?: string | null
          created_at?: string
          cuenta_id?: string
          id?: string
          nombre?: string | null
          proveedor_id?: string | null
          proveedor_nombre?: string | null
          ref_proveedor?: string | null
          ultimo_precio?: number | null
        }
        Update: {
          codigo_interno?: string | null
          created_at?: string
          cuenta_id?: string
          id?: string
          nombre?: string | null
          proveedor_id?: string | null
          proveedor_nombre?: string | null
          ref_proveedor?: string | null
          ultimo_precio?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "compras_producto_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_producto_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "compras_proveedor"
            referencedColumns: ["id"]
          },
        ]
      }
      compras_proveedor: {
        Row: {
          alias: string | null
          autorizado: boolean | null
          categoria: string | null
          centro_defecto_id: string | null
          created_at: string
          critico: boolean | null
          cuenta_contable: string | null
          cuenta_id: string
          cuenta_proveedor: string | null
          departamento: string | null
          id: string
          muestra_factura_url: string | null
          muestra_url: string | null
          nif: string | null
          nif_norm: string | null
          nombre: string
          nombre_norm: string | null
          pauta_factura: string | null
          pautas: string | null
        }
        Insert: {
          alias?: string | null
          autorizado?: boolean | null
          categoria?: string | null
          centro_defecto_id?: string | null
          created_at?: string
          critico?: boolean | null
          cuenta_contable?: string | null
          cuenta_id?: string
          cuenta_proveedor?: string | null
          departamento?: string | null
          id?: string
          muestra_factura_url?: string | null
          muestra_url?: string | null
          nif?: string | null
          nif_norm?: string | null
          nombre: string
          nombre_norm?: string | null
          pauta_factura?: string | null
          pautas?: string | null
        }
        Update: {
          alias?: string | null
          autorizado?: boolean | null
          categoria?: string | null
          centro_defecto_id?: string | null
          created_at?: string
          critico?: boolean | null
          cuenta_contable?: string | null
          cuenta_id?: string
          cuenta_proveedor?: string | null
          departamento?: string | null
          id?: string
          muestra_factura_url?: string | null
          muestra_url?: string | null
          nif?: string | null
          nif_norm?: string | null
          nombre?: string
          nombre_norm?: string | null
          pauta_factura?: string | null
          pautas?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compras_proveedor_centro_defecto_id_fkey"
            columns: ["centro_defecto_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_proveedor_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      compras_regla: {
        Row: {
          activa: boolean
          created_at: string
          cuenta_id: string
          id: string
          texto: string
        }
        Insert: {
          activa?: boolean
          created_at?: string
          cuenta_id?: string
          id?: string
          texto: string
        }
        Update: {
          activa?: boolean
          created_at?: string
          cuenta_id?: string
          id?: string
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "compras_regla_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      consentimientos: {
        Row: {
          cliente_id: string
          cuenta_id: string
          estado: string
          evidencia: Json | null
          finalidad: string
          id: string
          ocurrido_en: string
          origen: string
        }
        Insert: {
          cliente_id: string
          cuenta_id?: string
          estado: string
          evidencia?: Json | null
          finalidad: string
          id?: string
          ocurrido_en?: string
          origen: string
        }
        Update: {
          cliente_id?: string
          cuenta_id?: string
          estado?: string
          evidencia?: Json | null
          finalidad?: string
          id?: string
          ocurrido_en?: string
          origen?: string
        }
        Relationships: [
          {
            foreignKeyName: "consentimientos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consentimientos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes_consentimiento_vigente"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "consentimientos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_campanas: {
        Row: {
          asunto: string | null
          audiencia: Json | null
          centro_id: string | null
          creado_en: string
          cuenta_id: string
          cuerpo_html: string | null
          cuerpo_texto: string | null
          enviada_en: string | null
          estado: string
          id: string
          lista_id: string | null
          nombre: string
          plantilla_id: string | null
          preencabezado: string | null
          programada_para: string | null
          remitente_email: string | null
          remitente_nombre: string | null
          segmento_id: string | null
        }
        Insert: {
          asunto?: string | null
          audiencia?: Json | null
          centro_id?: string | null
          creado_en?: string
          cuenta_id?: string
          cuerpo_html?: string | null
          cuerpo_texto?: string | null
          enviada_en?: string | null
          estado?: string
          id?: string
          lista_id?: string | null
          nombre: string
          plantilla_id?: string | null
          preencabezado?: string | null
          programada_para?: string | null
          remitente_email?: string | null
          remitente_nombre?: string | null
          segmento_id?: string | null
        }
        Update: {
          asunto?: string | null
          audiencia?: Json | null
          centro_id?: string | null
          creado_en?: string
          cuenta_id?: string
          cuerpo_html?: string | null
          cuerpo_texto?: string | null
          enviada_en?: string | null
          estado?: string
          id?: string
          lista_id?: string | null
          nombre?: string
          plantilla_id?: string | null
          preencabezado?: string | null
          programada_para?: string | null
          remitente_email?: string | null
          remitente_nombre?: string | null
          segmento_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_campanas_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campanas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campanas_lista_id_fkey"
            columns: ["lista_id"]
            isOneToOne: false
            referencedRelation: "crm_listas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campanas_plantilla_id_fkey"
            columns: ["plantilla_id"]
            isOneToOne: false
            referencedRelation: "crm_plantillas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campanas_segmento_id_fkey"
            columns: ["segmento_id"]
            isOneToOne: false
            referencedRelation: "crm_segmentos"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_canales: {
        Row: {
          actualizado_en: string
          canal: string
          config: Json
          cuenta_id: string
          estado: string
          proveedor: string | null
        }
        Insert: {
          actualizado_en?: string
          canal: string
          config?: Json
          cuenta_id?: string
          estado?: string
          proveedor?: string | null
        }
        Update: {
          actualizado_en?: string
          canal?: string
          config?: Json
          cuenta_id?: string
          estado?: string
          proveedor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_canales_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_envios: {
        Row: {
          campana_id: string
          cliente_id: string
          creado_en: string
          cuenta_id: string
          email_norm: string
          enviado_en: string | null
          error: string | null
          estado: string
          id: string
          proveedor_id: string | null
        }
        Insert: {
          campana_id: string
          cliente_id: string
          creado_en?: string
          cuenta_id?: string
          email_norm: string
          enviado_en?: string | null
          error?: string | null
          estado?: string
          id?: string
          proveedor_id?: string | null
        }
        Update: {
          campana_id?: string
          cliente_id?: string
          creado_en?: string
          cuenta_id?: string
          email_norm?: string
          enviado_en?: string | null
          error?: string | null
          estado?: string
          id?: string
          proveedor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_envios_campana_id_fkey"
            columns: ["campana_id"]
            isOneToOne: false
            referencedRelation: "crm_campanas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_envios_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_envios_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes_consentimiento_vigente"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "crm_envios_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_eventos_envio: {
        Row: {
          cuenta_id: string
          datos: Json | null
          envio_id: string
          id: string
          ocurrido_en: string
          tipo: string
        }
        Insert: {
          cuenta_id?: string
          datos?: Json | null
          envio_id: string
          id?: string
          ocurrido_en?: string
          tipo: string
        }
        Update: {
          cuenta_id?: string
          datos?: Json | null
          envio_id?: string
          id?: string
          ocurrido_en?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_eventos_envio_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_eventos_envio_envio_id_fkey"
            columns: ["envio_id"]
            isOneToOne: false
            referencedRelation: "crm_envios"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lista_clientes: {
        Row: {
          anadido_en: string
          cliente_id: string
          cuenta_id: string
          lista_id: string
        }
        Insert: {
          anadido_en?: string
          cliente_id: string
          cuenta_id?: string
          lista_id: string
        }
        Update: {
          anadido_en?: string
          cliente_id?: string
          cuenta_id?: string
          lista_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lista_clientes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lista_clientes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes_consentimiento_vigente"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "crm_lista_clientes_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lista_clientes_lista_id_fkey"
            columns: ["lista_id"]
            isOneToOne: false
            referencedRelation: "crm_listas"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_listas: {
        Row: {
          creado_en: string
          cuenta_id: string
          descripcion: string | null
          id: string
          nombre: string
        }
        Insert: {
          creado_en?: string
          cuenta_id?: string
          descripcion?: string | null
          id?: string
          nombre: string
        }
        Update: {
          creado_en?: string
          cuenta_id?: string
          descripcion?: string | null
          id?: string
          nombre?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_listas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_plantillas: {
        Row: {
          actualizado_en: string
          asunto: string | null
          canal: string
          creado_en: string
          cuenta_id: string
          cuerpo_html: string | null
          id: string
          nombre: string
        }
        Insert: {
          actualizado_en?: string
          asunto?: string | null
          canal?: string
          creado_en?: string
          cuenta_id?: string
          cuerpo_html?: string | null
          id?: string
          nombre: string
        }
        Update: {
          actualizado_en?: string
          asunto?: string | null
          canal?: string
          creado_en?: string
          cuenta_id?: string
          cuerpo_html?: string | null
          id?: string
          nombre?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_plantillas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_segmentos: {
        Row: {
          creado_en: string
          cuenta_id: string
          definicion: Json
          descripcion: string | null
          id: string
          nombre: string
        }
        Insert: {
          creado_en?: string
          cuenta_id?: string
          definicion?: Json
          descripcion?: string | null
          id?: string
          nombre: string
        }
        Update: {
          creado_en?: string
          cuenta_id?: string
          definicion?: Json
          descripcion?: string | null
          id?: string
          nombre?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_segmentos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      cuentas: {
        Row: {
          creada_en: string
          estado: string
          id: string
          nombre: string
          plan: string
        }
        Insert: {
          creada_en?: string
          estado?: string
          id?: string
          nombre: string
          plan?: string
        }
        Update: {
          creada_en?: string
          estado?: string
          id?: string
          nombre?: string
          plan?: string
        }
        Relationships: []
      }
      curso_inscripciones: {
        Row: {
          actualizado_en: string
          apellidos: string
          centro_id: string
          centro_trabajo_legado: string | null
          codigo_certificado: string | null
          creado_en: string
          cuenta_id: string
          dni: string | null
          dni_purgado_en: string | null
          email: string
          empleado_id: string | null
          estado: Database["public"]["Enums"]["curso_estado_inscripcion"]
          fecha_certificado: string | null
          id: string
          nombre: string
          nota_final: number | null
          puesto: string
          rgpd_aceptado: boolean
          telefono: string
        }
        Insert: {
          actualizado_en?: string
          apellidos: string
          centro_id: string
          centro_trabajo_legado?: string | null
          codigo_certificado?: string | null
          creado_en?: string
          cuenta_id?: string
          dni?: string | null
          dni_purgado_en?: string | null
          email: string
          empleado_id?: string | null
          estado?: Database["public"]["Enums"]["curso_estado_inscripcion"]
          fecha_certificado?: string | null
          id?: string
          nombre: string
          nota_final?: number | null
          puesto: string
          rgpd_aceptado?: boolean
          telefono: string
        }
        Update: {
          actualizado_en?: string
          apellidos?: string
          centro_id?: string
          centro_trabajo_legado?: string | null
          codigo_certificado?: string | null
          creado_en?: string
          cuenta_id?: string
          dni?: string | null
          dni_purgado_en?: string | null
          email?: string
          empleado_id?: string | null
          estado?: Database["public"]["Enums"]["curso_estado_inscripcion"]
          fecha_certificado?: string | null
          id?: string
          nombre?: string
          nota_final?: number | null
          puesto?: string
          rgpd_aceptado?: boolean
          telefono?: string
        }
        Relationships: [
          {
            foreignKeyName: "curso_inscripciones_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curso_inscripciones_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curso_inscripciones_empleado_id_fkey"
            columns: ["empleado_id"]
            isOneToOne: false
            referencedRelation: "empleados"
            referencedColumns: ["id"]
          },
        ]
      }
      curso_intentos: {
        Row: {
          aciertos: number
          aprobado: boolean
          cuenta_id: string
          duracion_segundos: number | null
          fecha: string
          id: string
          inscripcion_id: string
          intento: number
          respuestas: Json | null
          total: number
        }
        Insert: {
          aciertos: number
          aprobado: boolean
          cuenta_id?: string
          duracion_segundos?: number | null
          fecha?: string
          id?: string
          inscripcion_id: string
          intento: number
          respuestas?: Json | null
          total?: number
        }
        Update: {
          aciertos?: number
          aprobado?: boolean
          cuenta_id?: string
          duracion_segundos?: number | null
          fecha?: string
          id?: string
          inscripcion_id?: string
          intento?: number
          respuestas?: Json | null
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "curso_intentos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curso_intentos_inscripcion_id_fkey"
            columns: ["inscripcion_id"]
            isOneToOne: false
            referencedRelation: "curso_inscripciones"
            referencedColumns: ["id"]
          },
        ]
      }
      departamentos: {
        Row: {
          activo: boolean
          creado_en: string
          cuenta_id: string
          id: string
          nombre: string
          orden: number
        }
        Insert: {
          activo?: boolean
          creado_en?: string
          cuenta_id?: string
          id?: string
          nombre: string
          orden?: number
        }
        Update: {
          activo?: boolean
          creado_en?: string
          cuenta_id?: string
          id?: string
          nombre?: string
          orden?: number
        }
        Relationships: [
          {
            foreignKeyName: "departamentos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      docs_categorias: {
        Row: {
          activo: boolean
          creado_en: string
          cuenta_id: string
          id: string
          nombre: string
          orden: number
        }
        Insert: {
          activo?: boolean
          creado_en?: string
          cuenta_id?: string
          id?: string
          nombre: string
          orden?: number
        }
        Update: {
          activo?: boolean
          creado_en?: string
          cuenta_id?: string
          id?: string
          nombre?: string
          orden?: number
        }
        Relationships: [
          {
            foreignKeyName: "docs_categorias_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      docs_documentos: {
        Row: {
          actualizado_en: string
          archivo_nombre: string
          archivo_path: string
          archivo_tamano: number | null
          archivo_tipo: string | null
          categoria_id: string
          centro_id: string | null
          creado_en: string
          cuenta_id: string
          descripcion: string | null
          id: string
          nombre: string
          subcategoria_id: string | null
          subido_por: string | null
          subido_por_legado: string | null
        }
        Insert: {
          actualizado_en?: string
          archivo_nombre: string
          archivo_path: string
          archivo_tamano?: number | null
          archivo_tipo?: string | null
          categoria_id: string
          centro_id?: string | null
          creado_en?: string
          cuenta_id?: string
          descripcion?: string | null
          id?: string
          nombre: string
          subcategoria_id?: string | null
          subido_por?: string | null
          subido_por_legado?: string | null
        }
        Update: {
          actualizado_en?: string
          archivo_nombre?: string
          archivo_path?: string
          archivo_tamano?: number | null
          archivo_tipo?: string | null
          categoria_id?: string
          centro_id?: string | null
          creado_en?: string
          cuenta_id?: string
          descripcion?: string | null
          id?: string
          nombre?: string
          subcategoria_id?: string | null
          subido_por?: string | null
          subido_por_legado?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "docs_documentos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "docs_categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docs_documentos_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docs_documentos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docs_documentos_subcategoria_id_fkey"
            columns: ["subcategoria_id"]
            isOneToOne: false
            referencedRelation: "docs_subcategorias"
            referencedColumns: ["id"]
          },
        ]
      }
      docs_subcategorias: {
        Row: {
          activo: boolean
          categoria_id: string
          creado_en: string
          cuenta_id: string
          id: string
          nombre: string
          orden: number
        }
        Insert: {
          activo?: boolean
          categoria_id: string
          creado_en?: string
          cuenta_id?: string
          id?: string
          nombre: string
          orden?: number
        }
        Update: {
          activo?: boolean
          categoria_id?: string
          creado_en?: string
          cuenta_id?: string
          id?: string
          nombre?: string
          orden?: number
        }
        Relationships: [
          {
            foreignKeyName: "docs_subcategorias_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "docs_categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docs_subcategorias_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      empleados: {
        Row: {
          apellidos: string | null
          area_funcional: Database["public"]["Enums"]["area_funcional"] | null
          centro_principal_id: string | null
          creado_en: string
          cuenta_id: string
          departamento: string | null
          departamento_id: string | null
          dni_ultimos: string | null
          email: string | null
          fecha_alta: string | null
          fecha_baja: string | null
          fichaje_movil: boolean
          horas_semana: number | null
          id: string
          nombre: string
          pin_hash: string | null
          telefono: string | null
          tipo_contrato: string | null
          user_id: string | null
        }
        Insert: {
          apellidos?: string | null
          area_funcional?: Database["public"]["Enums"]["area_funcional"] | null
          centro_principal_id?: string | null
          creado_en?: string
          cuenta_id?: string
          departamento?: string | null
          departamento_id?: string | null
          dni_ultimos?: string | null
          email?: string | null
          fecha_alta?: string | null
          fecha_baja?: string | null
          fichaje_movil?: boolean
          horas_semana?: number | null
          id?: string
          nombre: string
          pin_hash?: string | null
          telefono?: string | null
          tipo_contrato?: string | null
          user_id?: string | null
        }
        Update: {
          apellidos?: string | null
          area_funcional?: Database["public"]["Enums"]["area_funcional"] | null
          centro_principal_id?: string | null
          creado_en?: string
          cuenta_id?: string
          departamento?: string | null
          departamento_id?: string | null
          dni_ultimos?: string | null
          email?: string | null
          fecha_alta?: string | null
          fecha_baja?: string | null
          fichaje_movil?: boolean
          horas_semana?: number | null
          id?: string
          nombre?: string
          pin_hash?: string | null
          telefono?: string | null
          tipo_contrato?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "empleados_centro_principal_id_fkey"
            columns: ["centro_principal_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empleados_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empleados_departamento_id_fkey"
            columns: ["departamento_id"]
            isOneToOne: false
            referencedRelation: "departamentos"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_activos: {
        Row: {
          actualizado_en: string
          anios_vida_util: number
          centro_id: string | null
          codigo: string | null
          compra_doc_id: string | null
          creado_en: string
          cuenta_activo_id: string
          cuenta_amortizacion_id: string | null
          cuenta_dotacion_id: string | null
          cuenta_id: string
          descripcion: string | null
          estado: string
          fecha_alta: string
          fecha_baja: string | null
          id: string
          motivo_baja: string | null
          nombre: string
          notas: string | null
          proveedor: string | null
          sociedad_id: string
          valor_adquisicion: number
          valor_baja: number | null
          valor_residual: number
        }
        Insert: {
          actualizado_en?: string
          anios_vida_util: number
          centro_id?: string | null
          codigo?: string | null
          compra_doc_id?: string | null
          creado_en?: string
          cuenta_activo_id: string
          cuenta_amortizacion_id?: string | null
          cuenta_dotacion_id?: string | null
          cuenta_id: string
          descripcion?: string | null
          estado?: string
          fecha_alta: string
          fecha_baja?: string | null
          id?: string
          motivo_baja?: string | null
          nombre: string
          notas?: string | null
          proveedor?: string | null
          sociedad_id: string
          valor_adquisicion: number
          valor_baja?: number | null
          valor_residual?: number
        }
        Update: {
          actualizado_en?: string
          anios_vida_util?: number
          centro_id?: string | null
          codigo?: string | null
          compra_doc_id?: string | null
          creado_en?: string
          cuenta_activo_id?: string
          cuenta_amortizacion_id?: string | null
          cuenta_dotacion_id?: string | null
          cuenta_id?: string
          descripcion?: string | null
          estado?: string
          fecha_alta?: string
          fecha_baja?: string | null
          id?: string
          motivo_baja?: string | null
          nombre?: string
          notas?: string | null
          proveedor?: string | null
          sociedad_id?: string
          valor_adquisicion?: number
          valor_baja?: number | null
          valor_residual?: number
        }
        Relationships: [
          {
            foreignKeyName: "fin_activos_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_activos_compra_doc_id_fkey"
            columns: ["compra_doc_id"]
            isOneToOne: false
            referencedRelation: "compras_doc"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_activos_cuenta_activo_id_fkey"
            columns: ["cuenta_activo_id"]
            isOneToOne: false
            referencedRelation: "fin_plan_cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_activos_cuenta_amortizacion_id_fkey"
            columns: ["cuenta_amortizacion_id"]
            isOneToOne: false
            referencedRelation: "fin_plan_cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_activos_cuenta_dotacion_id_fkey"
            columns: ["cuenta_dotacion_id"]
            isOneToOne: false
            referencedRelation: "fin_plan_cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_activos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_activos_sociedad_id_fkey"
            columns: ["sociedad_id"]
            isOneToOne: false
            referencedRelation: "sociedades"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_amortizaciones: {
        Row: {
          activo_id: string
          actualizado_en: string
          acumulado: number
          asiento_id: string | null
          contabilizado: boolean
          creado_en: string
          cuenta_id: string
          ejercicio: number
          id: string
          importe: number
          periodo: number
        }
        Insert: {
          activo_id: string
          actualizado_en?: string
          acumulado: number
          asiento_id?: string | null
          contabilizado?: boolean
          creado_en?: string
          cuenta_id: string
          ejercicio: number
          id?: string
          importe: number
          periodo: number
        }
        Update: {
          activo_id?: string
          actualizado_en?: string
          acumulado?: number
          asiento_id?: string | null
          contabilizado?: boolean
          creado_en?: string
          cuenta_id?: string
          ejercicio?: number
          id?: string
          importe?: number
          periodo?: number
        }
        Relationships: [
          {
            foreignKeyName: "fin_amortizaciones_activo_id_fkey"
            columns: ["activo_id"]
            isOneToOne: false
            referencedRelation: "fin_activos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_amortizaciones_asiento_id_fkey"
            columns: ["asiento_id"]
            isOneToOne: false
            referencedRelation: "fin_asientos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_amortizaciones_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_apuntes: {
        Row: {
          asiento_id: string
          cuenta_id: string
          cuenta_plan_id: string
          debe: number
          descripcion: string | null
          haber: number
          id: string
          orden: number
        }
        Insert: {
          asiento_id: string
          cuenta_id: string
          cuenta_plan_id: string
          debe?: number
          descripcion?: string | null
          haber?: number
          id?: string
          orden?: number
        }
        Update: {
          asiento_id?: string
          cuenta_id?: string
          cuenta_plan_id?: string
          debe?: number
          descripcion?: string | null
          haber?: number
          id?: string
          orden?: number
        }
        Relationships: [
          {
            foreignKeyName: "fin_apuntes_asiento_id_fkey"
            columns: ["asiento_id"]
            isOneToOne: false
            referencedRelation: "fin_asientos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_apuntes_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_apuntes_cuenta_plan_id_fkey"
            columns: ["cuenta_plan_id"]
            isOneToOne: false
            referencedRelation: "fin_plan_cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_asientos: {
        Row: {
          creado_en: string
          creado_por: string | null
          cuenta_id: string
          descripcion: string | null
          ejercicio_id: string
          estado: string
          fecha: string
          id: string
          numero: number | null
          origen_id: string | null
          origen_tipo: string
          sociedad_id: string
        }
        Insert: {
          creado_en?: string
          creado_por?: string | null
          cuenta_id: string
          descripcion?: string | null
          ejercicio_id: string
          estado?: string
          fecha: string
          id?: string
          numero?: number | null
          origen_id?: string | null
          origen_tipo?: string
          sociedad_id: string
        }
        Update: {
          creado_en?: string
          creado_por?: string | null
          cuenta_id?: string
          descripcion?: string | null
          ejercicio_id?: string
          estado?: string
          fecha?: string
          id?: string
          numero?: number | null
          origen_id?: string | null
          origen_tipo?: string
          sociedad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fin_asientos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_asientos_ejercicio_id_fkey"
            columns: ["ejercicio_id"]
            isOneToOne: false
            referencedRelation: "fin_ejercicios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_asientos_sociedad_id_fkey"
            columns: ["sociedad_id"]
            isOneToOne: false
            referencedRelation: "sociedades"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_bancos_cuentas: {
        Row: {
          activa: boolean
          actualizado_en: string
          bic: string | null
          creado_en: string
          cuenta_id: string
          es_defecto: boolean
          iban: string
          id: string
          nombre: string
          sociedad_id: string
          titular: string | null
        }
        Insert: {
          activa?: boolean
          actualizado_en?: string
          bic?: string | null
          creado_en?: string
          cuenta_id: string
          es_defecto?: boolean
          iban: string
          id?: string
          nombre: string
          sociedad_id: string
          titular?: string | null
        }
        Update: {
          activa?: boolean
          actualizado_en?: string
          bic?: string | null
          creado_en?: string
          cuenta_id?: string
          es_defecto?: boolean
          iban?: string
          id?: string
          nombre?: string
          sociedad_id?: string
          titular?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fin_bancos_cuentas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_bancos_cuentas_sociedad_id_fkey"
            columns: ["sociedad_id"]
            isOneToOne: false
            referencedRelation: "sociedades"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_clientes: {
        Row: {
          activo: boolean
          actualizado_en: string
          codigo_postal: string | null
          comensal_id: string | null
          creado_en: string
          cuenta_id: string
          dias_vencimiento: number
          direccion: string | null
          email: string | null
          iban: string | null
          id: string
          municipio: string | null
          nif: string | null
          nif_norm: string | null
          nombre_comercial: string | null
          nombre_fiscal: string
          notas: string | null
          pais: string
          provincia: string | null
          retencion_pct: number
          telefono: string | null
          tipo_iva_defecto: number
        }
        Insert: {
          activo?: boolean
          actualizado_en?: string
          codigo_postal?: string | null
          comensal_id?: string | null
          creado_en?: string
          cuenta_id: string
          dias_vencimiento?: number
          direccion?: string | null
          email?: string | null
          iban?: string | null
          id?: string
          municipio?: string | null
          nif?: string | null
          nif_norm?: string | null
          nombre_comercial?: string | null
          nombre_fiscal: string
          notas?: string | null
          pais?: string
          provincia?: string | null
          retencion_pct?: number
          telefono?: string | null
          tipo_iva_defecto?: number
        }
        Update: {
          activo?: boolean
          actualizado_en?: string
          codigo_postal?: string | null
          comensal_id?: string | null
          creado_en?: string
          cuenta_id?: string
          dias_vencimiento?: number
          direccion?: string | null
          email?: string | null
          iban?: string | null
          id?: string
          municipio?: string | null
          nif?: string | null
          nif_norm?: string | null
          nombre_comercial?: string | null
          nombre_fiscal?: string
          notas?: string | null
          pais?: string
          provincia?: string | null
          retencion_pct?: number
          telefono?: string | null
          tipo_iva_defecto?: number
        }
        Relationships: [
          {
            foreignKeyName: "fin_clientes_comensal_id_fkey"
            columns: ["comensal_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_clientes_comensal_id_fkey"
            columns: ["comensal_id"]
            isOneToOne: false
            referencedRelation: "clientes_consentimiento_vigente"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "fin_clientes_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_config: {
        Row: {
          actualizado_en: string
          creado_en: string
          cuenta_id: string
          identificador_acreedor: string | null
          pie_factura: string | null
          regimen_iva: string
          retencion_defecto: number
          serie_defecto_id: string | null
          sociedad_id: string
          verifactu_modo: string
        }
        Insert: {
          actualizado_en?: string
          creado_en?: string
          cuenta_id: string
          identificador_acreedor?: string | null
          pie_factura?: string | null
          regimen_iva?: string
          retencion_defecto?: number
          serie_defecto_id?: string | null
          sociedad_id: string
          verifactu_modo?: string
        }
        Update: {
          actualizado_en?: string
          creado_en?: string
          cuenta_id?: string
          identificador_acreedor?: string | null
          pie_factura?: string | null
          regimen_iva?: string
          retencion_defecto?: number
          serie_defecto_id?: string | null
          sociedad_id?: string
          verifactu_modo?: string
        }
        Relationships: [
          {
            foreignKeyName: "fin_config_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_config_serie_fk"
            columns: ["serie_defecto_id"]
            isOneToOne: false
            referencedRelation: "fin_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_config_sociedad_id_fkey"
            columns: ["sociedad_id"]
            isOneToOne: true
            referencedRelation: "sociedades"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_ejercicios: {
        Row: {
          anio: number
          cuenta_id: string
          estado: string
          fecha_fin: string
          fecha_inicio: string
          id: string
          sociedad_id: string
        }
        Insert: {
          anio: number
          cuenta_id: string
          estado?: string
          fecha_fin: string
          fecha_inicio: string
          id?: string
          sociedad_id: string
        }
        Update: {
          anio?: number
          cuenta_id?: string
          estado?: string
          fecha_fin?: string
          fecha_inicio?: string
          id?: string
          sociedad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fin_ejercicios_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_ejercicios_sociedad_id_fkey"
            columns: ["sociedad_id"]
            isOneToOne: false
            referencedRelation: "sociedades"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_factura_impuestos: {
        Row: {
          base: number
          cuenta_id: string
          cuota: number
          factura_id: string
          id: string
          impuesto: string
          tipo_pct: number
        }
        Insert: {
          base: number
          cuenta_id: string
          cuota: number
          factura_id: string
          id?: string
          impuesto?: string
          tipo_pct: number
        }
        Update: {
          base?: number
          cuenta_id?: string
          cuota?: number
          factura_id?: string
          id?: string
          impuesto?: string
          tipo_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "fin_factura_impuestos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_factura_impuestos_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "fin_facturas"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_factura_lineas: {
        Row: {
          base: number
          cantidad: number
          concepto: string
          cuenta_id: string
          cuota_iva: number
          cuota_retencion: number
          descuento_pct: number
          factura_id: string
          id: string
          orden: number
          precio_unitario: number
          tipo_iva: number
          tipo_retencion: number
          total: number
        }
        Insert: {
          base?: number
          cantidad?: number
          concepto: string
          cuenta_id: string
          cuota_iva?: number
          cuota_retencion?: number
          descuento_pct?: number
          factura_id: string
          id?: string
          orden?: number
          precio_unitario?: number
          tipo_iva?: number
          tipo_retencion?: number
          total?: number
        }
        Update: {
          base?: number
          cantidad?: number
          concepto?: string
          cuenta_id?: string
          cuota_iva?: number
          cuota_retencion?: number
          descuento_pct?: number
          factura_id?: string
          id?: string
          orden?: number
          precio_unitario?: number
          tipo_iva?: number
          tipo_retencion?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "fin_factura_lineas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_factura_lineas_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "fin_facturas"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_facturas: {
        Row: {
          actualizado_en: string
          base_total: number
          centro_id: string | null
          cliente_id: string | null
          creado_en: string
          creado_por: string | null
          cuenta_id: string
          cuota_iva_total: number
          cuota_retencion: number
          descripcion_operacion: string | null
          ejercicio: number
          estado: string
          estado_cobro: string
          expedida_por: string | null
          factura_rectificada_id: string | null
          fecha_expedicion: string | null
          fecha_operacion: string | null
          id: string
          importe_cobrado: number
          moneda: string
          motivo_rectificacion: string | null
          notas_internas: string | null
          numero: number | null
          numero_completo: string | null
          serie_id: string
          sociedad_id: string
          tipo: string
          tipo_rectificativa: string | null
          total: number
        }
        Insert: {
          actualizado_en?: string
          base_total?: number
          centro_id?: string | null
          cliente_id?: string | null
          creado_en?: string
          creado_por?: string | null
          cuenta_id: string
          cuota_iva_total?: number
          cuota_retencion?: number
          descripcion_operacion?: string | null
          ejercicio: number
          estado?: string
          estado_cobro?: string
          expedida_por?: string | null
          factura_rectificada_id?: string | null
          fecha_expedicion?: string | null
          fecha_operacion?: string | null
          id?: string
          importe_cobrado?: number
          moneda?: string
          motivo_rectificacion?: string | null
          notas_internas?: string | null
          numero?: number | null
          numero_completo?: string | null
          serie_id: string
          sociedad_id: string
          tipo?: string
          tipo_rectificativa?: string | null
          total?: number
        }
        Update: {
          actualizado_en?: string
          base_total?: number
          centro_id?: string | null
          cliente_id?: string | null
          creado_en?: string
          creado_por?: string | null
          cuenta_id?: string
          cuota_iva_total?: number
          cuota_retencion?: number
          descripcion_operacion?: string | null
          ejercicio?: number
          estado?: string
          estado_cobro?: string
          expedida_por?: string | null
          factura_rectificada_id?: string | null
          fecha_expedicion?: string | null
          fecha_operacion?: string | null
          id?: string
          importe_cobrado?: number
          moneda?: string
          motivo_rectificacion?: string | null
          notas_internas?: string | null
          numero?: number | null
          numero_completo?: string | null
          serie_id?: string
          sociedad_id?: string
          tipo?: string
          tipo_rectificativa?: string | null
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "fin_facturas_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_facturas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "fin_clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_facturas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_facturas_factura_rectificada_id_fkey"
            columns: ["factura_rectificada_id"]
            isOneToOne: false
            referencedRelation: "fin_facturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_facturas_serie_id_fkey"
            columns: ["serie_id"]
            isOneToOne: false
            referencedRelation: "fin_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_facturas_sociedad_id_fkey"
            columns: ["sociedad_id"]
            isOneToOne: false
            referencedRelation: "sociedades"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_mandatos: {
        Row: {
          actualizado_en: string
          bic: string | null
          cliente_id: string
          creado_en: string
          cuenta_id: string
          estado: string
          fecha_firma: string
          fecha_ultimo_uso: string | null
          iban: string
          id: string
          notas: string | null
          referencia: string
          tipo: string
          usado: boolean
        }
        Insert: {
          actualizado_en?: string
          bic?: string | null
          cliente_id: string
          creado_en?: string
          cuenta_id: string
          estado?: string
          fecha_firma: string
          fecha_ultimo_uso?: string | null
          iban: string
          id?: string
          notas?: string | null
          referencia: string
          tipo?: string
          usado?: boolean
        }
        Update: {
          actualizado_en?: string
          bic?: string | null
          cliente_id?: string
          creado_en?: string
          cuenta_id?: string
          estado?: string
          fecha_firma?: string
          fecha_ultimo_uso?: string | null
          iban?: string
          id?: string
          notas?: string | null
          referencia?: string
          tipo?: string
          usado?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "fin_mandatos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "fin_clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_mandatos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_periodos: {
        Row: {
          bloqueado: boolean
          cuenta_id: string
          ejercicio_id: string
          id: string
          mes: number
        }
        Insert: {
          bloqueado?: boolean
          cuenta_id: string
          ejercicio_id: string
          id?: string
          mes: number
        }
        Update: {
          bloqueado?: boolean
          cuenta_id?: string
          ejercicio_id?: string
          id?: string
          mes?: number
        }
        Relationships: [
          {
            foreignKeyName: "fin_periodos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_periodos_ejercicio_id_fkey"
            columns: ["ejercicio_id"]
            isOneToOne: false
            referencedRelation: "fin_ejercicios"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_plan_cuentas: {
        Row: {
          activo: boolean
          actualizado_en: string
          codigo: string
          contrapartida: string | null
          creado_en: string
          cuenta_id: string
          id: string
          nif: string | null
          nombre: string
          origen: string
          sociedad_id: string
        }
        Insert: {
          activo?: boolean
          actualizado_en?: string
          codigo: string
          contrapartida?: string | null
          creado_en?: string
          cuenta_id: string
          id?: string
          nif?: string | null
          nombre: string
          origen?: string
          sociedad_id: string
        }
        Update: {
          activo?: boolean
          actualizado_en?: string
          codigo?: string
          contrapartida?: string | null
          creado_en?: string
          cuenta_id?: string
          id?: string
          nif?: string | null
          nombre?: string
          origen?: string
          sociedad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fin_plan_cuentas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_plan_cuentas_sociedad_id_fkey"
            columns: ["sociedad_id"]
            isOneToOne: false
            referencedRelation: "sociedades"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_proveedor_condiciones: {
        Row: {
          actualizado_en: string
          creado_en: string
          cuenta_id: string
          dias_pago: number
          forma_pago: string | null
          iban: string | null
          notas: string | null
          proveedor_id: string
        }
        Insert: {
          actualizado_en?: string
          creado_en?: string
          cuenta_id: string
          dias_pago?: number
          forma_pago?: string | null
          iban?: string | null
          notas?: string | null
          proveedor_id: string
        }
        Update: {
          actualizado_en?: string
          creado_en?: string
          cuenta_id?: string
          dias_pago?: number
          forma_pago?: string | null
          iban?: string | null
          notas?: string | null
          proveedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fin_proveedor_condiciones_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_proveedor_condiciones_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: true
            referencedRelation: "compras_proveedor"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_remesas: {
        Row: {
          actualizado_en: string
          banco_cuenta_id: string
          concepto: string | null
          creado_en: string
          cuenta_id: string
          enviada_en: string | null
          estado: string
          fecha_ejecucion: string
          generada_en: string | null
          id: string
          nombre_fichero: string | null
          num_items: number
          sentido: string
          sociedad_id: string
          total: number
        }
        Insert: {
          actualizado_en?: string
          banco_cuenta_id: string
          concepto?: string | null
          creado_en?: string
          cuenta_id: string
          enviada_en?: string | null
          estado?: string
          fecha_ejecucion: string
          generada_en?: string | null
          id?: string
          nombre_fichero?: string | null
          num_items?: number
          sentido: string
          sociedad_id: string
          total?: number
        }
        Update: {
          actualizado_en?: string
          banco_cuenta_id?: string
          concepto?: string | null
          creado_en?: string
          cuenta_id?: string
          enviada_en?: string | null
          estado?: string
          fecha_ejecucion?: string
          generada_en?: string | null
          id?: string
          nombre_fichero?: string | null
          num_items?: number
          sentido?: string
          sociedad_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "fin_remesas_banco_cuenta_id_fkey"
            columns: ["banco_cuenta_id"]
            isOneToOne: false
            referencedRelation: "fin_bancos_cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_remesas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_remesas_sociedad_id_fkey"
            columns: ["sociedad_id"]
            isOneToOne: false
            referencedRelation: "sociedades"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_remesas_items: {
        Row: {
          bic: string | null
          concepto: string | null
          creado_en: string
          cuenta_id: string
          iban: string
          id: string
          importe: number
          mandato_fecha: string | null
          mandato_ref: string | null
          nombre: string
          referencia: string | null
          remesa_id: string
          secuencia: string | null
          vencimiento_id: string
        }
        Insert: {
          bic?: string | null
          concepto?: string | null
          creado_en?: string
          cuenta_id: string
          iban: string
          id?: string
          importe: number
          mandato_fecha?: string | null
          mandato_ref?: string | null
          nombre: string
          referencia?: string | null
          remesa_id: string
          secuencia?: string | null
          vencimiento_id: string
        }
        Update: {
          bic?: string | null
          concepto?: string | null
          creado_en?: string
          cuenta_id?: string
          iban?: string
          id?: string
          importe?: number
          mandato_fecha?: string | null
          mandato_ref?: string | null
          nombre?: string
          referencia?: string | null
          remesa_id?: string
          secuencia?: string | null
          vencimiento_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fin_remesas_items_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_remesas_items_remesa_id_fkey"
            columns: ["remesa_id"]
            isOneToOne: false
            referencedRelation: "fin_remesas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_remesas_items_vencimiento_id_fkey"
            columns: ["vencimiento_id"]
            isOneToOne: false
            referencedRelation: "fin_vencimientos"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_series: {
        Row: {
          activa: boolean
          codigo: string
          creado_en: string
          cuenta_id: string
          descripcion: string | null
          ejercicio: number
          id: string
          siguiente_numero: number
          sociedad_id: string
          tipo_defecto: string
        }
        Insert: {
          activa?: boolean
          codigo: string
          creado_en?: string
          cuenta_id: string
          descripcion?: string | null
          ejercicio: number
          id?: string
          siguiente_numero?: number
          sociedad_id: string
          tipo_defecto?: string
        }
        Update: {
          activa?: boolean
          codigo?: string
          creado_en?: string
          cuenta_id?: string
          descripcion?: string | null
          ejercicio?: number
          id?: string
          siguiente_numero?: number
          sociedad_id?: string
          tipo_defecto?: string
        }
        Relationships: [
          {
            foreignKeyName: "fin_series_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_series_sociedad_id_fkey"
            columns: ["sociedad_id"]
            isOneToOne: false
            referencedRelation: "sociedades"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_vencimientos: {
        Row: {
          actualizado_en: string
          compra_doc_id: string | null
          creado_en: string
          cuenta_id: string
          estado: string
          factura_id: string | null
          fecha_vencimiento: string
          forma_pago: string | null
          id: string
          importe: number
          importe_liquidado: number
          notas: string | null
          sentido: string
          sociedad_id: string | null
        }
        Insert: {
          actualizado_en?: string
          compra_doc_id?: string | null
          creado_en?: string
          cuenta_id: string
          estado?: string
          factura_id?: string | null
          fecha_vencimiento: string
          forma_pago?: string | null
          id?: string
          importe: number
          importe_liquidado?: number
          notas?: string | null
          sentido: string
          sociedad_id?: string | null
        }
        Update: {
          actualizado_en?: string
          compra_doc_id?: string | null
          creado_en?: string
          cuenta_id?: string
          estado?: string
          factura_id?: string | null
          fecha_vencimiento?: string
          forma_pago?: string | null
          id?: string
          importe?: number
          importe_liquidado?: number
          notas?: string | null
          sentido?: string
          sociedad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fin_vencimientos_compra_doc_id_fkey"
            columns: ["compra_doc_id"]
            isOneToOne: false
            referencedRelation: "compras_doc"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_vencimientos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_vencimientos_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "fin_facturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_vencimientos_sociedad_id_fkey"
            columns: ["sociedad_id"]
            isOneToOne: false
            referencedRelation: "sociedades"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_verifactu_envios: {
        Row: {
          actualizado_en: string
          creado_en: string
          csv_aeat: string | null
          cuenta_id: string
          enviado_en: string | null
          estado: string
          id: string
          intento: number
          registro_id: string
          respuesta: Json | null
        }
        Insert: {
          actualizado_en?: string
          creado_en?: string
          csv_aeat?: string | null
          cuenta_id: string
          enviado_en?: string | null
          estado?: string
          id?: string
          intento?: number
          registro_id: string
          respuesta?: Json | null
        }
        Update: {
          actualizado_en?: string
          creado_en?: string
          csv_aeat?: string | null
          cuenta_id?: string
          enviado_en?: string | null
          estado?: string
          id?: string
          intento?: number
          registro_id?: string
          respuesta?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "fin_verifactu_envios_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_verifactu_envios_registro_id_fkey"
            columns: ["registro_id"]
            isOneToOne: false
            referencedRelation: "fin_verifactu_registros"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_verifactu_eventos: {
        Row: {
          creado_en: string
          cuenta_id: string
          detalle: Json | null
          id: string
          sociedad_id: string | null
          tipo: string
        }
        Insert: {
          creado_en?: string
          cuenta_id: string
          detalle?: Json | null
          id?: string
          sociedad_id?: string | null
          tipo: string
        }
        Update: {
          creado_en?: string
          cuenta_id?: string
          detalle?: Json | null
          id?: string
          sociedad_id?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "fin_verifactu_eventos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_verifactu_eventos_sociedad_id_fkey"
            columns: ["sociedad_id"]
            isOneToOne: false
            referencedRelation: "sociedades"
            referencedColumns: ["id"]
          },
        ]
      }
      fin_verifactu_registros: {
        Row: {
          creado_en: string
          cuenta_id: string
          factura_id: string
          fecha_hora_registro: string
          huella: string
          huella_anterior: string | null
          id: string
          orden: number
          payload: Json
          sociedad_id: string
          tipo_registro: string
        }
        Insert: {
          creado_en?: string
          cuenta_id: string
          factura_id: string
          fecha_hora_registro?: string
          huella: string
          huella_anterior?: string | null
          id?: string
          orden: number
          payload: Json
          sociedad_id: string
          tipo_registro: string
        }
        Update: {
          creado_en?: string
          cuenta_id?: string
          factura_id?: string
          fecha_hora_registro?: string
          huella?: string
          huella_anterior?: string | null
          id?: string
          orden?: number
          payload?: Json
          sociedad_id?: string
          tipo_registro?: string
        }
        Relationships: [
          {
            foreignKeyName: "fin_verifactu_registros_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_verifactu_registros_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "fin_facturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fin_verifactu_registros_sociedad_id_fkey"
            columns: ["sociedad_id"]
            isOneToOne: false
            referencedRelation: "sociedades"
            referencedColumns: ["id"]
          },
        ]
      }
      modulos: {
        Row: {
          area: string
          id: string
          nombre: string
        }
        Insert: {
          area: string
          id: string
          nombre: string
        }
        Update: {
          area?: string
          id?: string
          nombre?: string
        }
        Relationships: []
      }
      modulos_contratados: {
        Row: {
          activo: boolean
          contratado_en: string
          cuenta_id: string
          modulo_id: string
        }
        Insert: {
          activo?: boolean
          contratado_en?: string
          cuenta_id: string
          modulo_id: string
        }
        Update: {
          activo?: boolean
          contratado_en?: string
          cuenta_id?: string
          modulo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "modulos_contratados_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modulos_contratados_modulo_id_fkey"
            columns: ["modulo_id"]
            isOneToOne: false
            referencedRelation: "modulos"
            referencedColumns: ["id"]
          },
        ]
      }
      operadores: {
        Row: {
          correo: string
          creado_en: string
          id: string
          nombre: string | null
        }
        Insert: {
          correo: string
          creado_en?: string
          id: string
          nombre?: string | null
        }
        Update: {
          correo?: string
          creado_en?: string
          id?: string
          nombre?: string | null
        }
        Relationships: []
      }
      perfiles: {
        Row: {
          correo: string
          creado_en: string
          cuenta_id: string
          id: string
          nombre: string | null
          rol: string
        }
        Insert: {
          correo: string
          creado_en?: string
          cuenta_id: string
          id: string
          nombre?: string | null
          rol?: string
        }
        Update: {
          correo?: string
          creado_en?: string
          cuenta_id?: string
          id?: string
          nombre?: string | null
          rol?: string
        }
        Relationships: [
          {
            foreignKeyName: "perfiles_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      reservas_cierres: {
        Row: {
          cuenta_id: string
          fecha: string
          id: string
          motivo: string | null
          restaurante_id: string
          turno_id: string | null
        }
        Insert: {
          cuenta_id?: string
          fecha: string
          id?: string
          motivo?: string | null
          restaurante_id: string
          turno_id?: string | null
        }
        Update: {
          cuenta_id?: string
          fecha?: string
          id?: string
          motivo?: string | null
          restaurante_id?: string
          turno_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservas_cierres_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_cierres_restaurante_id_fkey"
            columns: ["restaurante_id"]
            isOneToOne: false
            referencedRelation: "reservas_restaurantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_cierres_turno_id_fkey"
            columns: ["turno_id"]
            isOneToOne: false
            referencedRelation: "reservas_turnos"
            referencedColumns: ["id"]
          },
        ]
      }
      reservas_clientes: {
        Row: {
          alergias: string | null
          cliente_id: string | null
          creado_en: string
          cuenta_id: string
          email: string | null
          id: string
          nombre: string | null
          notas: string | null
          telefono: string | null
          vip: boolean
        }
        Insert: {
          alergias?: string | null
          cliente_id?: string | null
          creado_en?: string
          cuenta_id?: string
          email?: string | null
          id?: string
          nombre?: string | null
          notas?: string | null
          telefono?: string | null
          vip?: boolean
        }
        Update: {
          alergias?: string | null
          cliente_id?: string | null
          creado_en?: string
          cuenta_id?: string
          email?: string | null
          id?: string
          nombre?: string | null
          notas?: string | null
          telefono?: string | null
          vip?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "reservas_clientes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_clientes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes_consentimiento_vigente"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "reservas_clientes_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      reservas_emails_salientes: {
        Row: {
          asunto: string
          creado_en: string
          cuenta_id: string
          cuerpo: string
          destinatario: string
          estado: string
          id: string
          reserva_id: string | null
          restaurante_id: string | null
        }
        Insert: {
          asunto: string
          creado_en?: string
          cuenta_id?: string
          cuerpo: string
          destinatario: string
          estado?: string
          id?: string
          reserva_id?: string | null
          restaurante_id?: string | null
        }
        Update: {
          asunto?: string
          creado_en?: string
          cuenta_id?: string
          cuerpo?: string
          destinatario?: string
          estado?: string
          id?: string
          reserva_id?: string | null
          restaurante_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservas_emails_salientes_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_emails_salientes_reserva_id_fkey"
            columns: ["reserva_id"]
            isOneToOne: false
            referencedRelation: "reservas_reservas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_emails_salientes_restaurante_id_fkey"
            columns: ["restaurante_id"]
            isOneToOne: false
            referencedRelation: "reservas_restaurantes"
            referencedColumns: ["id"]
          },
        ]
      }
      reservas_lista_espera: {
        Row: {
          creado_en: string
          cuenta_id: string
          estado: string
          fecha: string
          id: string
          nombre: string
          notas: string | null
          pax: number
          restaurante_id: string
          telefono: string
        }
        Insert: {
          creado_en?: string
          cuenta_id?: string
          estado?: string
          fecha: string
          id?: string
          nombre: string
          notas?: string | null
          pax: number
          restaurante_id: string
          telefono: string
        }
        Update: {
          creado_en?: string
          cuenta_id?: string
          estado?: string
          fecha?: string
          id?: string
          nombre?: string
          notas?: string | null
          pax?: number
          restaurante_id?: string
          telefono?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservas_lista_espera_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_lista_espera_restaurante_id_fkey"
            columns: ["restaurante_id"]
            isOneToOne: false
            referencedRelation: "reservas_restaurantes"
            referencedColumns: ["id"]
          },
        ]
      }
      reservas_mesas: {
        Row: {
          activa: boolean
          cap_max: number
          cap_min: number
          cuenta_id: string
          forma: string
          id: string
          nombre: string
          pos_x: number
          pos_y: number
          reservable_online: boolean
          sala_id: string
        }
        Insert: {
          activa?: boolean
          cap_max?: number
          cap_min?: number
          cuenta_id?: string
          forma?: string
          id?: string
          nombre: string
          pos_x?: number
          pos_y?: number
          reservable_online?: boolean
          sala_id: string
        }
        Update: {
          activa?: boolean
          cap_max?: number
          cap_min?: number
          cuenta_id?: string
          forma?: string
          id?: string
          nombre?: string
          pos_x?: number
          pos_y?: number
          reservable_online?: boolean
          sala_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservas_mesas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_mesas_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "reservas_salas"
            referencedColumns: ["id"]
          },
        ]
      }
      reservas_reserva_mesas: {
        Row: {
          cuenta_id: string
          mesa_id: string
          reserva_id: string
        }
        Insert: {
          cuenta_id?: string
          mesa_id: string
          reserva_id: string
        }
        Update: {
          cuenta_id?: string
          mesa_id?: string
          reserva_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservas_reserva_mesas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_reserva_mesas_mesa_id_fkey"
            columns: ["mesa_id"]
            isOneToOne: false
            referencedRelation: "reservas_mesas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_reserva_mesas_reserva_id_fkey"
            columns: ["reserva_id"]
            isOneToOne: false
            referencedRelation: "reservas_reservas"
            referencedColumns: ["id"]
          },
        ]
      }
      reservas_reservas: {
        Row: {
          actualizado_en: string
          canal: string | null
          cliente_id: string | null
          creado_en: string
          cuenta_id: string
          duracion_min: number
          estado: string
          fecha: string
          hora: string
          id: string
          localizador: string
          mesa_id: string | null
          notas_cliente: string | null
          notas_internas: string | null
          origen: string
          pax: number
          restaurante_id: string
          turno_id: string | null
        }
        Insert: {
          actualizado_en?: string
          canal?: string | null
          cliente_id?: string | null
          creado_en?: string
          cuenta_id?: string
          duracion_min?: number
          estado?: string
          fecha: string
          hora: string
          id?: string
          localizador?: string
          mesa_id?: string | null
          notas_cliente?: string | null
          notas_internas?: string | null
          origen?: string
          pax: number
          restaurante_id: string
          turno_id?: string | null
        }
        Update: {
          actualizado_en?: string
          canal?: string | null
          cliente_id?: string | null
          creado_en?: string
          cuenta_id?: string
          duracion_min?: number
          estado?: string
          fecha?: string
          hora?: string
          id?: string
          localizador?: string
          mesa_id?: string | null
          notas_cliente?: string | null
          notas_internas?: string | null
          origen?: string
          pax?: number
          restaurante_id?: string
          turno_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservas_reservas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "reservas_clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_reservas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_reservas_mesa_id_fkey"
            columns: ["mesa_id"]
            isOneToOne: false
            referencedRelation: "reservas_mesas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_reservas_restaurante_id_fkey"
            columns: ["restaurante_id"]
            isOneToOne: false
            referencedRelation: "reservas_restaurantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_reservas_turno_id_fkey"
            columns: ["turno_id"]
            isOneToOne: false
            referencedRelation: "reservas_turnos"
            referencedColumns: ["id"]
          },
        ]
      }
      reservas_restaurantes: {
        Row: {
          activo: boolean
          antelacion_max_dias: number
          antelacion_min_horas: number
          centro_id: string | null
          creado_en: string
          cuenta_id: string
          descripcion: string | null
          email: string | null
          email_reservas: string | null
          id: string
          nombre: string
          online_activo: boolean
          orden: number
          slug: string
          telefono: string | null
          ubicacion: string | null
        }
        Insert: {
          activo?: boolean
          antelacion_max_dias?: number
          antelacion_min_horas?: number
          centro_id?: string | null
          creado_en?: string
          cuenta_id?: string
          descripcion?: string | null
          email?: string | null
          email_reservas?: string | null
          id?: string
          nombre: string
          online_activo?: boolean
          orden?: number
          slug: string
          telefono?: string | null
          ubicacion?: string | null
        }
        Update: {
          activo?: boolean
          antelacion_max_dias?: number
          antelacion_min_horas?: number
          centro_id?: string | null
          creado_en?: string
          cuenta_id?: string
          descripcion?: string | null
          email?: string | null
          email_reservas?: string | null
          id?: string
          nombre?: string
          online_activo?: boolean
          orden?: number
          slug?: string
          telefono?: string | null
          ubicacion?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservas_restaurantes_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_restaurantes_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      reservas_salas: {
        Row: {
          activa: boolean
          cuenta_id: string
          id: string
          nombre: string
          orden: number
          restaurante_id: string
        }
        Insert: {
          activa?: boolean
          cuenta_id?: string
          id?: string
          nombre: string
          orden?: number
          restaurante_id: string
        }
        Update: {
          activa?: boolean
          cuenta_id?: string
          id?: string
          nombre?: string
          orden?: number
          restaurante_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservas_salas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_salas_restaurante_id_fkey"
            columns: ["restaurante_id"]
            isOneToOne: false
            referencedRelation: "reservas_restaurantes"
            referencedColumns: ["id"]
          },
        ]
      }
      reservas_turnos: {
        Row: {
          activo: boolean
          cuenta_id: string
          dias_semana: number[]
          duracion_min: number
          hora_fin: string
          hora_inicio: string
          id: string
          intervalo_min: number
          max_pax_online: number
          nombre: string
          restaurante_id: string
        }
        Insert: {
          activo?: boolean
          cuenta_id?: string
          dias_semana?: number[]
          duracion_min?: number
          hora_fin: string
          hora_inicio: string
          id?: string
          intervalo_min?: number
          max_pax_online?: number
          nombre: string
          restaurante_id: string
        }
        Update: {
          activo?: boolean
          cuenta_id?: string
          dias_semana?: number[]
          duracion_min?: number
          hora_fin?: string
          hora_inicio?: string
          id?: string
          intervalo_min?: number
          max_pax_online?: number
          nombre?: string
          restaurante_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservas_turnos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_turnos_restaurante_id_fkey"
            columns: ["restaurante_id"]
            isOneToOne: false
            referencedRelation: "reservas_restaurantes"
            referencedColumns: ["id"]
          },
        ]
      }
      rrhh_asignaciones: {
        Row: {
          centro_id: string
          cuenta_id: string
          empleado_id: string
          fecha_fin: string | null
          fecha_inicio: string | null
          id: string
        }
        Insert: {
          centro_id: string
          cuenta_id?: string
          empleado_id: string
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
        }
        Update: {
          centro_id?: string
          cuenta_id?: string
          empleado_id?: string
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rrhh_asignaciones_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rrhh_asignaciones_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rrhh_asignaciones_empleado_id_fkey"
            columns: ["empleado_id"]
            isOneToOne: false
            referencedRelation: "empleados"
            referencedColumns: ["id"]
          },
        ]
      }
      rrhh_ausencias: {
        Row: {
          creado_en: string
          cuenta_id: string
          empleado_id: string
          estado: Database["public"]["Enums"]["rrhh_estado_ausencia"]
          fecha_fin: string
          fecha_inicio: string
          id: string
          resuelta_por: string | null
          solicitada_por: string | null
          tipo: Database["public"]["Enums"]["rrhh_tipo_ausencia"]
        }
        Insert: {
          creado_en?: string
          cuenta_id?: string
          empleado_id: string
          estado?: Database["public"]["Enums"]["rrhh_estado_ausencia"]
          fecha_fin: string
          fecha_inicio: string
          id?: string
          resuelta_por?: string | null
          solicitada_por?: string | null
          tipo: Database["public"]["Enums"]["rrhh_tipo_ausencia"]
        }
        Update: {
          creado_en?: string
          cuenta_id?: string
          empleado_id?: string
          estado?: Database["public"]["Enums"]["rrhh_estado_ausencia"]
          fecha_fin?: string
          fecha_inicio?: string
          id?: string
          resuelta_por?: string | null
          solicitada_por?: string | null
          tipo?: Database["public"]["Enums"]["rrhh_tipo_ausencia"]
        }
        Relationships: [
          {
            foreignKeyName: "rrhh_ausencias_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rrhh_ausencias_empleado_id_fkey"
            columns: ["empleado_id"]
            isOneToOne: false
            referencedRelation: "empleados"
            referencedColumns: ["id"]
          },
        ]
      }
      rrhh_centros_config: {
        Row: {
          centro_id: string
          convenio_id: string | null
          cuenta_id: string
          pacto_descanso_10h: boolean
          radio_fichaje_m: number
        }
        Insert: {
          centro_id: string
          convenio_id?: string | null
          cuenta_id?: string
          pacto_descanso_10h?: boolean
          radio_fichaje_m?: number
        }
        Update: {
          centro_id?: string
          convenio_id?: string | null
          cuenta_id?: string
          pacto_descanso_10h?: boolean
          radio_fichaje_m?: number
        }
        Relationships: [
          {
            foreignKeyName: "rrhh_centros_config_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: true
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rrhh_centros_config_convenio_id_fkey"
            columns: ["convenio_id"]
            isOneToOne: false
            referencedRelation: "rrhh_convenios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rrhh_centros_config_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      rrhh_convenios: {
        Row: {
          creado_en: string
          cuenta_id: string
          descanso_diario_h: number | null
          descanso_semanal_dias: number | null
          es_por_defecto: boolean
          id: string
          jornada_max_diaria_h: number | null
          jornada_max_semanal_h: number | null
          jornada_min_diaria_h: number | null
          max_dias_consecutivos: number | null
          nombre: string
          pausa_min_minutos: number | null
          pausa_tras_h: number | null
        }
        Insert: {
          creado_en?: string
          cuenta_id?: string
          descanso_diario_h?: number | null
          descanso_semanal_dias?: number | null
          es_por_defecto?: boolean
          id?: string
          jornada_max_diaria_h?: number | null
          jornada_max_semanal_h?: number | null
          jornada_min_diaria_h?: number | null
          max_dias_consecutivos?: number | null
          nombre: string
          pausa_min_minutos?: number | null
          pausa_tras_h?: number | null
        }
        Update: {
          creado_en?: string
          cuenta_id?: string
          descanso_diario_h?: number | null
          descanso_semanal_dias?: number | null
          es_por_defecto?: boolean
          id?: string
          jornada_max_diaria_h?: number | null
          jornada_max_semanal_h?: number | null
          jornada_min_diaria_h?: number | null
          max_dias_consecutivos?: number | null
          nombre?: string
          pausa_min_minutos?: number | null
          pausa_tras_h?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rrhh_convenios_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      rrhh_dispositivos: {
        Row: {
          activo: boolean
          centro_id: string
          creado_en: string
          cuenta_id: string
          id: string
          nombre: string | null
          token_hash: string | null
        }
        Insert: {
          activo?: boolean
          centro_id: string
          creado_en?: string
          cuenta_id?: string
          id?: string
          nombre?: string | null
          token_hash?: string | null
        }
        Update: {
          activo?: boolean
          centro_id?: string
          creado_en?: string
          cuenta_id?: string
          id?: string
          nombre?: string | null
          token_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rrhh_dispositivos_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rrhh_dispositivos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      rrhh_encargados_centro: {
        Row: {
          centro_id: string
          cuenta_id: string
          user_id: string
        }
        Insert: {
          centro_id: string
          cuenta_id?: string
          user_id: string
        }
        Update: {
          centro_id?: string
          cuenta_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rrhh_encargados_centro_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rrhh_encargados_centro_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      rrhh_fichajes: {
        Row: {
          centro_id: string
          corregido_por: string | null
          corrige_a: string | null
          creado_en: string
          cuenta_id: string
          dentro_radio: boolean | null
          dispositivo_id: string | null
          empleado_id: string
          id: string
          lat: number | null
          lng: number | null
          metodo: Database["public"]["Enums"]["rrhh_metodo_fichaje"]
          motivo_correccion: string | null
          tipo: Database["public"]["Enums"]["rrhh_tipo_fichaje"]
          ts: string
        }
        Insert: {
          centro_id: string
          corregido_por?: string | null
          corrige_a?: string | null
          creado_en?: string
          cuenta_id?: string
          dentro_radio?: boolean | null
          dispositivo_id?: string | null
          empleado_id: string
          id?: string
          lat?: number | null
          lng?: number | null
          metodo: Database["public"]["Enums"]["rrhh_metodo_fichaje"]
          motivo_correccion?: string | null
          tipo: Database["public"]["Enums"]["rrhh_tipo_fichaje"]
          ts?: string
        }
        Update: {
          centro_id?: string
          corregido_por?: string | null
          corrige_a?: string | null
          creado_en?: string
          cuenta_id?: string
          dentro_radio?: boolean | null
          dispositivo_id?: string | null
          empleado_id?: string
          id?: string
          lat?: number | null
          lng?: number | null
          metodo?: Database["public"]["Enums"]["rrhh_metodo_fichaje"]
          motivo_correccion?: string | null
          tipo?: Database["public"]["Enums"]["rrhh_tipo_fichaje"]
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "rrhh_fichajes_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rrhh_fichajes_corrige_a_fkey"
            columns: ["corrige_a"]
            isOneToOne: false
            referencedRelation: "rrhh_fichajes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rrhh_fichajes_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rrhh_fichajes_empleado_id_fkey"
            columns: ["empleado_id"]
            isOneToOne: false
            referencedRelation: "empleados"
            referencedColumns: ["id"]
          },
        ]
      }
      rrhh_periodos_contrato: {
        Row: {
          creado_en: string
          cuenta_id: string
          empleado_id: string
          fecha_alta: string
          fecha_baja: string | null
          horas_semana: number | null
          id: string
          nota: string | null
        }
        Insert: {
          creado_en?: string
          cuenta_id?: string
          empleado_id: string
          fecha_alta: string
          fecha_baja?: string | null
          horas_semana?: number | null
          id?: string
          nota?: string | null
        }
        Update: {
          creado_en?: string
          cuenta_id?: string
          empleado_id?: string
          fecha_alta?: string
          fecha_baja?: string | null
          horas_semana?: number | null
          id?: string
          nota?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rrhh_periodos_contrato_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rrhh_periodos_contrato_empleado_id_fkey"
            columns: ["empleado_id"]
            isOneToOne: false
            referencedRelation: "empleados"
            referencedColumns: ["id"]
          },
        ]
      }
      rrhh_tipos_ausencia: {
        Row: {
          activo: boolean
          computa_vacaciones: boolean
          creado_en: string
          cuenta_id: string
          id: string
          nombre: string
          orden: number
          solicitable_empleado: boolean
        }
        Insert: {
          activo?: boolean
          computa_vacaciones?: boolean
          creado_en?: string
          cuenta_id?: string
          id?: string
          nombre: string
          orden?: number
          solicitable_empleado?: boolean
        }
        Update: {
          activo?: boolean
          computa_vacaciones?: boolean
          creado_en?: string
          cuenta_id?: string
          id?: string
          nombre?: string
          orden?: number
          solicitable_empleado?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "rrhh_tipos_ausencia_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      rrhh_tipos_contrato: {
        Row: {
          activo: boolean
          creado_en: string
          cuenta_id: string
          id: string
          nombre: string
          orden: number
        }
        Insert: {
          activo?: boolean
          creado_en?: string
          cuenta_id?: string
          id?: string
          nombre: string
          orden?: number
        }
        Update: {
          activo?: boolean
          creado_en?: string
          cuenta_id?: string
          id?: string
          nombre?: string
          orden?: number
        }
        Relationships: [
          {
            foreignKeyName: "rrhh_tipos_contrato_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      rrhh_turnos: {
        Row: {
          centro_id: string
          creado_en: string
          creado_por: string | null
          cuenta_id: string
          empleado_id: string
          estado: Database["public"]["Enums"]["rrhh_estado_turno"]
          fecha: string
          hora_fin: string
          hora_inicio: string
          id: string
          pausa_min: number
          publicado_at: string | null
          puesto: string | null
        }
        Insert: {
          centro_id: string
          creado_en?: string
          creado_por?: string | null
          cuenta_id?: string
          empleado_id: string
          estado?: Database["public"]["Enums"]["rrhh_estado_turno"]
          fecha: string
          hora_fin: string
          hora_inicio: string
          id?: string
          pausa_min?: number
          publicado_at?: string | null
          puesto?: string | null
        }
        Update: {
          centro_id?: string
          creado_en?: string
          creado_por?: string | null
          cuenta_id?: string
          empleado_id?: string
          estado?: Database["public"]["Enums"]["rrhh_estado_turno"]
          fecha?: string
          hora_fin?: string
          hora_inicio?: string
          id?: string
          pausa_min?: number
          publicado_at?: string | null
          puesto?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rrhh_turnos_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rrhh_turnos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rrhh_turnos_empleado_id_fkey"
            columns: ["empleado_id"]
            isOneToOne: false
            referencedRelation: "empleados"
            referencedColumns: ["id"]
          },
        ]
      }
      sociedades: {
        Row: {
          cif: string | null
          creada_en: string
          cuenta_id: string
          direccion: string | null
          email: string | null
          id: string
          nombre: string
          telefono: string | null
        }
        Insert: {
          cif?: string | null
          creada_en?: string
          cuenta_id: string
          direccion?: string | null
          email?: string | null
          id?: string
          nombre: string
          telefono?: string | null
        }
        Update: {
          cif?: string | null
          creada_en?: string
          cuenta_id?: string
          direccion?: string | null
          email?: string | null
          id?: string
          nombre?: string
          telefono?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sociedades_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      supresiones: {
        Row: {
          canal: string
          cliente_id: string | null
          creado_en: string
          cuenta_id: string
          detalle: string | null
          id: string
          motivo: string
          valor_norm: string
        }
        Insert: {
          canal: string
          cliente_id?: string | null
          creado_en?: string
          cuenta_id?: string
          detalle?: string | null
          id?: string
          motivo?: string
          valor_norm: string
        }
        Update: {
          canal?: string
          cliente_id?: string | null
          creado_en?: string
          cuenta_id?: string
          detalle?: string | null
          id?: string
          motivo?: string
          valor_norm?: string
        }
        Relationships: [
          {
            foreignKeyName: "supresiones_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supresiones_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes_consentimiento_vigente"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "supresiones_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      visitas_bonos: {
        Row: {
          agora_registrado_at: string | null
          beneficiario_nombre: string | null
          caduca_at: string | null
          codigo_canje: string
          comprador_email: string
          comprador_nombre: string
          cuenta_id: string
          estado: Database["public"]["Enums"]["visitas_estado_bono"]
          fecha_canje: string | null
          fecha_venta: string
          id: string
          importe: number
          producto_id: string
          reserva_canje_id: string | null
          ticket_agora_id: string | null
          unidades: number
        }
        Insert: {
          agora_registrado_at?: string | null
          beneficiario_nombre?: string | null
          caduca_at?: string | null
          codigo_canje?: string
          comprador_email: string
          comprador_nombre: string
          cuenta_id?: string
          estado?: Database["public"]["Enums"]["visitas_estado_bono"]
          fecha_canje?: string | null
          fecha_venta?: string
          id?: string
          importe: number
          producto_id: string
          reserva_canje_id?: string | null
          ticket_agora_id?: string | null
          unidades?: number
        }
        Update: {
          agora_registrado_at?: string | null
          beneficiario_nombre?: string | null
          caduca_at?: string | null
          codigo_canje?: string
          comprador_email?: string
          comprador_nombre?: string
          cuenta_id?: string
          estado?: Database["public"]["Enums"]["visitas_estado_bono"]
          fecha_canje?: string | null
          fecha_venta?: string
          id?: string
          importe?: number
          producto_id?: string
          reserva_canje_id?: string | null
          ticket_agora_id?: string | null
          unidades?: number
        }
        Relationships: [
          {
            foreignKeyName: "visitas_bonos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitas_bonos_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "visitas_productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitas_bonos_reserva_canje_fkey"
            columns: ["reserva_canje_id"]
            isOneToOne: false
            referencedRelation: "visitas_reservas"
            referencedColumns: ["id"]
          },
        ]
      }
      visitas_productos: {
        Row: {
          activo: boolean
          aforo_default: number | null
          caducidad_meses: number | null
          created_at: string
          cuenta_id: string
          descripcion_en: string | null
          descripcion_es: string | null
          descripcion_fr: string | null
          duracion_min: number | null
          id: string
          idioma: Database["public"]["Enums"]["visitas_idioma"] | null
          nombre_en: string | null
          nombre_es: string
          nombre_fr: string | null
          orden: number | null
          precio: number
          tipo: Database["public"]["Enums"]["visitas_tipo_producto"]
          tipo_bono: Database["public"]["Enums"]["visitas_tipo_bono"] | null
        }
        Insert: {
          activo?: boolean
          aforo_default?: number | null
          caducidad_meses?: number | null
          created_at?: string
          cuenta_id?: string
          descripcion_en?: string | null
          descripcion_es?: string | null
          descripcion_fr?: string | null
          duracion_min?: number | null
          id?: string
          idioma?: Database["public"]["Enums"]["visitas_idioma"] | null
          nombre_en?: string | null
          nombre_es: string
          nombre_fr?: string | null
          orden?: number | null
          precio: number
          tipo: Database["public"]["Enums"]["visitas_tipo_producto"]
          tipo_bono?: Database["public"]["Enums"]["visitas_tipo_bono"] | null
        }
        Update: {
          activo?: boolean
          aforo_default?: number | null
          caducidad_meses?: number | null
          created_at?: string
          cuenta_id?: string
          descripcion_en?: string | null
          descripcion_es?: string | null
          descripcion_fr?: string | null
          duracion_min?: number | null
          id?: string
          idioma?: Database["public"]["Enums"]["visitas_idioma"] | null
          nombre_en?: string | null
          nombre_es?: string
          nombre_fr?: string | null
          orden?: number | null
          precio?: number
          tipo?: Database["public"]["Enums"]["visitas_tipo_producto"]
          tipo_bono?: Database["public"]["Enums"]["visitas_tipo_bono"] | null
        }
        Relationships: [
          {
            foreignKeyName: "visitas_productos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      visitas_reservas: {
        Row: {
          agora_registrado_at: string | null
          bono_id: string | null
          cancelada_at: string | null
          check_in_at: string | null
          cliente_email: string
          cliente_id: string | null
          cliente_nombre: string
          cliente_pais: string | null
          cliente_telefono: string | null
          codigo_reserva: string
          created_at: string
          cuenta_id: string
          estado: Database["public"]["Enums"]["visitas_estado_reserva"]
          id: string
          idioma_preferido: Database["public"]["Enums"]["visitas_idioma"] | null
          importe_total: number
          metodo_pago: Database["public"]["Enums"]["visitas_metodo_pago"]
          num_personas: number
          sesion_id: string
          ticket_agora_id: string | null
        }
        Insert: {
          agora_registrado_at?: string | null
          bono_id?: string | null
          cancelada_at?: string | null
          check_in_at?: string | null
          cliente_email: string
          cliente_id?: string | null
          cliente_nombre: string
          cliente_pais?: string | null
          cliente_telefono?: string | null
          codigo_reserva?: string
          created_at?: string
          cuenta_id?: string
          estado?: Database["public"]["Enums"]["visitas_estado_reserva"]
          id?: string
          idioma_preferido?:
            | Database["public"]["Enums"]["visitas_idioma"]
            | null
          importe_total: number
          metodo_pago: Database["public"]["Enums"]["visitas_metodo_pago"]
          num_personas: number
          sesion_id: string
          ticket_agora_id?: string | null
        }
        Update: {
          agora_registrado_at?: string | null
          bono_id?: string | null
          cancelada_at?: string | null
          check_in_at?: string | null
          cliente_email?: string
          cliente_id?: string | null
          cliente_nombre?: string
          cliente_pais?: string | null
          cliente_telefono?: string | null
          codigo_reserva?: string
          created_at?: string
          cuenta_id?: string
          estado?: Database["public"]["Enums"]["visitas_estado_reserva"]
          id?: string
          idioma_preferido?:
            | Database["public"]["Enums"]["visitas_idioma"]
            | null
          importe_total?: number
          metodo_pago?: Database["public"]["Enums"]["visitas_metodo_pago"]
          num_personas?: number
          sesion_id?: string
          ticket_agora_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visitas_reservas_bono_id_fkey"
            columns: ["bono_id"]
            isOneToOne: false
            referencedRelation: "visitas_bonos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitas_reservas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitas_reservas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes_consentimiento_vigente"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "visitas_reservas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitas_reservas_sesion_id_fkey"
            columns: ["sesion_id"]
            isOneToOne: false
            referencedRelation: "visitas_sesiones"
            referencedColumns: ["id"]
          },
        ]
      }
      visitas_sesiones: {
        Row: {
          aforo: number
          centro_id: string | null
          created_at: string
          cuenta_id: string
          estado: Database["public"]["Enums"]["visitas_estado_sesion"]
          fecha: string
          hora_inicio: string
          id: string
          nota: string | null
          producto_id: string
          visible_web: boolean
        }
        Insert: {
          aforo: number
          centro_id?: string | null
          created_at?: string
          cuenta_id?: string
          estado?: Database["public"]["Enums"]["visitas_estado_sesion"]
          fecha: string
          hora_inicio: string
          id?: string
          nota?: string | null
          producto_id: string
          visible_web?: boolean
        }
        Update: {
          aforo?: number
          centro_id?: string | null
          created_at?: string
          cuenta_id?: string
          estado?: Database["public"]["Enums"]["visitas_estado_sesion"]
          fecha?: string
          hora_inicio?: string
          id?: string
          nota?: string | null
          producto_id?: string
          visible_web?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "visitas_sesiones_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitas_sesiones_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitas_sesiones_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "visitas_productos"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      clientes_consentimiento_vigente: {
        Row: {
          cliente_id: string | null
          cuenta_id: string | null
          email: boolean | null
          sms: boolean | null
          whatsapp: boolean | null
        }
        Insert: {
          cliente_id?: string | null
          cuenta_id?: string | null
          email?: never
          sms?: never
          whatsapp?: never
        }
        Update: {
          cliente_id?: string | null
          cuenta_id?: string | null
          email?: never
          sms?: never
          whatsapp?: never
        }
        Relationships: [
          {
            foreignKeyName: "clientes_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      curso_dni_pendiente_purga: {
        Row: {
          con_dni_vivo: number | null
          proxima_purga: string | null
          vencidas_hoy: number | null
          ya_purgadas: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      buscar_cuenta_a3: {
        Args: { p_cuenta_id: string; p_nif: string; p_nombre: string }
        Returns: {
          contrapartida: string
          cuenta: string
          nombre: string
          via: string
        }[]
      }
      cliente_apto_email: { Args: { p_cliente_id: string }; Returns: boolean }
      compras_next_codigo: { Args: never; Returns: string }
      cuenta_actual: { Args: never; Returns: string }
      curso_purgar_dni: {
        Args: { p_anios?: number }
        Returns: {
          purgadas: number
        }[]
      }
      es_operador: { Args: never; Returns: boolean }
      fin_anular_factura: {
        Args: { p_factura_id: string; p_motivo: string }
        Returns: Json
      }
      fin_expedir_factura: { Args: { p_factura_id: string }; Returns: Json }
      fin_vf_cadena_alta: {
        Args: {
          p_cuota_total: number
          p_fecha_expedicion: string
          p_fecha_hora: string
          p_huella_anterior: string
          p_importe_total: number
          p_nif_emisor: string
          p_num_serie: string
          p_tipo_factura: string
        }
        Returns: string
      }
      fin_vf_cadena_anulacion: {
        Args: {
          p_fecha_expedicion: string
          p_fecha_hora: string
          p_huella_anterior: string
          p_nif_emisor: string
          p_num_serie: string
        }
        Returns: string
      }
      fin_vf_campo: {
        Args: { p_nombre: string; p_valor: string }
        Returns: string
      }
      fin_vf_fecha: { Args: { p: string }; Returns: string }
      fin_vf_fecha_hora: { Args: { p: string }; Returns: string }
      fin_vf_huella: { Args: { p_cadena: string }; Returns: string }
      fin_vf_importe: { Args: { p: number }; Returns: string }
      fin_vf_qr: {
        Args: {
          p_fecha: string
          p_importe: number
          p_nif: string
          p_num_serie: string
          p_produccion?: boolean
        }
        Returns: string
      }
      fin_vf_url_encode: { Args: { p_valor: string }; Returns: string }
      mi_empleado_id: { Args: never; Returns: string }
      norm_email: { Args: { t: string }; Returns: string }
      norm_nif: { Args: { t: string }; Returns: string }
      norm_nom: { Args: { t: string }; Returns: string }
      norm_telefono: { Args: { t: string }; Returns: string }
      reservas_apuntar_lista_espera: {
        Args: {
          p_fecha: string
          p_nombre: string
          p_notas: string
          p_pax: number
          p_slug: string
          p_telefono: string
        }
        Returns: Json
      }
      reservas_cancelar: {
        Args: { p_localizador: string; p_telefono: string }
        Returns: Json
      }
      reservas_consultar: {
        Args: { p_localizador: string; p_telefono: string }
        Returns: Json
      }
      reservas_crear_online: {
        Args: {
          p_email: string
          p_fecha: string
          p_hora: string
          p_nombre: string
          p_notas: string
          p_pax: number
          p_slug: string
          p_telefono: string
        }
        Returns: Json
      }
      reservas_disponibilidad: {
        Args: { p_fecha: string; p_pax: number; p_slug: string }
        Returns: Json
      }
      reservas_mejor_mesa: {
        Args: {
          p_duracion: number
          p_fecha: string
          p_hora: string
          p_pax: number
          p_restaurante: string
          p_solo_online: boolean
        }
        Returns: string
      }
      reservas_mesas_libres: {
        Args: {
          p_duracion: number
          p_fecha: string
          p_hora: string
          p_pax: number
          p_restaurante: string
        }
        Returns: number
      }
      reservas_norm_tel: { Args: { t: string }; Returns: string }
      reservas_sin_mesa_solapadas: {
        Args: {
          p_duracion: number
          p_fecha: string
          p_hora: string
          p_restaurante: string
        }
        Returns: number
      }
      rrhh_descanso_minimo_horas: {
        Args: { p_empleado_id: string }
        Returns: number
      }
      rrhh_empleado_activo_en: {
        Args: { dia: string; emp: string }
        Returns: boolean
      }
      rrhh_es_gestor: { Args: never; Returns: boolean }
      rrhh_gestiona_centro: { Args: { p_centro_id: string }; Returns: boolean }
      rrhh_horas_vigentes: {
        Args: { dia: string; emp: string }
        Returns: number
      }
      rrhh_plantilla_centro: { Args: { p_centro_id: string }; Returns: number }
      vincular_mi_empleado: { Args: never; Returns: string }
      visitas_cancelar_reserva: {
        Args: { p_codigo_reserva: string }
        Returns: undefined
      }
      visitas_canjear_bono: {
        Args: {
          p_codigo_canje: string
          p_nombre?: string
          p_num_personas?: number
          p_sesion_id: string
        }
        Returns: {
          agora_registrado_at: string | null
          bono_id: string | null
          cancelada_at: string | null
          check_in_at: string | null
          cliente_email: string
          cliente_id: string | null
          cliente_nombre: string
          cliente_pais: string | null
          cliente_telefono: string | null
          codigo_reserva: string
          created_at: string
          cuenta_id: string
          estado: Database["public"]["Enums"]["visitas_estado_reserva"]
          id: string
          idioma_preferido: Database["public"]["Enums"]["visitas_idioma"] | null
          importe_total: number
          metodo_pago: Database["public"]["Enums"]["visitas_metodo_pago"]
          num_personas: number
          sesion_id: string
          ticket_agora_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "visitas_reservas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      visitas_crear_reserva: {
        Args: {
          p_cliente_email: string
          p_cliente_nombre: string
          p_cliente_pais: string
          p_cliente_telefono: string
          p_idioma_preferido: Database["public"]["Enums"]["visitas_idioma"]
          p_importe_total: number
          p_metodo_pago?: Database["public"]["Enums"]["visitas_metodo_pago"]
          p_num_personas: number
          p_sesion_id: string
        }
        Returns: {
          agora_registrado_at: string | null
          bono_id: string | null
          cancelada_at: string | null
          check_in_at: string | null
          cliente_email: string
          cliente_id: string | null
          cliente_nombre: string
          cliente_pais: string | null
          cliente_telefono: string | null
          codigo_reserva: string
          created_at: string
          cuenta_id: string
          estado: Database["public"]["Enums"]["visitas_estado_reserva"]
          id: string
          idioma_preferido: Database["public"]["Enums"]["visitas_idioma"] | null
          importe_total: number
          metodo_pago: Database["public"]["Enums"]["visitas_metodo_pago"]
          num_personas: number
          sesion_id: string
          ticket_agora_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "visitas_reservas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      visitas_generar_sesiones: {
        Args: {
          p_aforo?: number
          p_centro_id?: string
          p_dias_semana: number[]
          p_fecha_desde: string
          p_fecha_hasta: string
          p_hora: string
          p_producto_id: string
        }
        Returns: number
      }
      visitas_plazas_disponibles: {
        Args: { p_sesion_id: string }
        Returns: number
      }
      visitas_validar_bono: {
        Args: { p_codigo_canje: string }
        Returns: {
          caduca_at: string
          concepto: string
          importe: number
          motivo: string
          valido: boolean
        }[]
      }
    }
    Enums: {
      agentes_plataforma:
        | "google"
        | "tripadvisor"
        | "thefork"
        | "web"
        | "instagram"
        | "facebook"
        | "otro"
      area_funcional: "primera" | "segunda" | "tercera" | "cuarta" | "quinta"
      curso_estado_inscripcion:
        | "iniciado"
        | "aprobado"
        | "suspenso_intento"
        | "suspenso_definitivo"
      rrhh_estado_ausencia: "solicitada" | "aprobada" | "rechazada"
      rrhh_estado_turno: "borrador" | "publicado"
      rrhh_metodo_fichaje: "tablet_pin" | "movil_geo" | "correccion"
      rrhh_tipo_ausencia: "vacaciones" | "baja" | "permiso" | "otro"
      rrhh_tipo_fichaje: "entrada" | "salida" | "pausa_inicio" | "pausa_fin"
      visitas_estado_bono: "vendido" | "canjeado" | "caducado"
      visitas_estado_reserva: "pendiente_pago" | "pagada" | "cancelada"
      visitas_estado_sesion: "activa" | "cancelada"
      visitas_idioma: "es" | "en" | "fr"
      visitas_metodo_pago: "stripe" | "agora_tpv" | "bono"
      visitas_tipo_bono: "visita" | "maridaje" | "importe"
      visitas_tipo_producto: "visita_experiencia" | "bono"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      agentes_plataforma: [
        "google",
        "tripadvisor",
        "thefork",
        "web",
        "instagram",
        "facebook",
        "otro",
      ],
      area_funcional: ["primera", "segunda", "tercera", "cuarta", "quinta"],
      curso_estado_inscripcion: [
        "iniciado",
        "aprobado",
        "suspenso_intento",
        "suspenso_definitivo",
      ],
      rrhh_estado_ausencia: ["solicitada", "aprobada", "rechazada"],
      rrhh_estado_turno: ["borrador", "publicado"],
      rrhh_metodo_fichaje: ["tablet_pin", "movil_geo", "correccion"],
      rrhh_tipo_ausencia: ["vacaciones", "baja", "permiso", "otro"],
      rrhh_tipo_fichaje: ["entrada", "salida", "pausa_inicio", "pausa_fin"],
      visitas_estado_bono: ["vendido", "canjeado", "caducado"],
      visitas_estado_reserva: ["pendiente_pago", "pagada", "cancelada"],
      visitas_estado_sesion: ["activa", "cancelada"],
      visitas_idioma: ["es", "en", "fr"],
      visitas_metodo_pago: ["stripe", "agora_tpv", "bono"],
      visitas_tipo_bono: ["visita", "maridaje", "importe"],
      visitas_tipo_producto: ["visita_experiencia", "bono"],
    },
  },
} as const
