export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      centros: {
        Row: {
          creado_en: string
          cuenta_id: string
          direccion: string | null
          email: string | null
          id: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cuenta_actual: { Args: never; Returns: string }
      es_operador: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
