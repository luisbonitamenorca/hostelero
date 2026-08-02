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
      [_ in never]: never
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
      compras_next_codigo: { Args: never; Returns: string }
      cuenta_actual: { Args: never; Returns: string }
      es_operador: { Args: never; Returns: boolean }
      norm_nif: { Args: { t: string }; Returns: string }
      norm_nom: { Args: { t: string }; Returns: string }
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
