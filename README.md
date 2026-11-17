# Evaluaciones Técnicas

Aplicación web para crear, publicar y presentar evaluaciones técnicas. Está construida con HTML, CSS y JavaScript nativo, utiliza Supabase como backend y puede desplegarse como sitio estático en Vercel.

> **Identidad visual**
>
> La interfaz usa una combinación de verde profundo (`#065F46`), menta (`#34D399`), fondos azul grisáceos y tipografías Inter y Plus Jakarta Sans. El README conserva esa misma idea: pasos cortos, bloques de configuración y una separación clara entre el trabajo del estudiante y la gestión docente.

## 1. Qué hace la aplicación

### Vista del estudiante

1. Muestra las evaluaciones activas disponibles.
2. Permite seleccionar un curso y una evaluación, o ingresar directamente su código.
3. Solicita nombre completo y número de documento.
4. Consulta cuántos intentos se han realizado para ese documento y esa evaluación.
5. Presenta preguntas de selección y de ordenamiento, con preguntas aleatorias según la configuración del banco.
6. Controla el tiempo disponible y solicita pantalla completa durante la evaluación.
7. Registra eventos de integridad, como la salida de pantalla completa.
8. Calcula la nota, el porcentaje y el desglose por módulo.
9. Guarda el resultado mediante una función RPC de Supabase y muestra el resumen del intento.

### Vista docente

El acceso docente se realiza con Supabase Auth. Después de iniciar sesión se habilitan tres pestañas:

- **Cargar nueva evaluación:** valida y guarda un archivo JSON de preguntas.
- **Gestión de evaluaciones:** consulta, activa, desactiva o elimina evaluaciones.
- **Reporte de calificaciones:** filtra resultados y exporta la información visible a CSV.

## 2. Requisitos

- Una cuenta de [Supabase](https://supabase.com/).
- Una cuenta de [Vercel](https://vercel.com/) si se desea publicar la aplicación.
- Un navegador actualizado con soporte para Web Crypto API y pantalla completa.
- Node.js y la CLI de Vercel son opcionales para probar el despliegue local.

No se requiere un framework ni un proceso de compilación. Los archivos principales son:

| Archivo | Responsabilidad |
| --- | --- |
| `index.html` | Estructura de las vistas estudiante y docente. |
| `styles.css` | Identidad visual, diseño responsive y estados de la interfaz. |
| `app.js` | Flujo de evaluación, autenticación, validaciones y consultas a Supabase. |
| `config.local.example.js` | Plantilla de configuración para pruebas locales. |
| `vercel.json` | Encabezados HTTP básicos para el despliegue. |

## 3. Crear el proyecto en Supabase

### Paso 1: crear el proyecto

1. Entra al panel de Supabase y selecciona **New project**.
2. Define el nombre, la contraseña de la base de datos y la región.
3. Espera a que el proyecto termine de aprovisionarse.
4. En **Project Settings > API**, identifica:
   - **Project URL**, que se usará como `SUPABASE_URL`.
   - **Publishable key** o clave pública, que se usará como `SUPABASE_ANON_KEY`.

La clave pública se utiliza desde el navegador y no reemplaza las políticas RLS. Nunca uses una `service_role` key en `app.js`, en `config.local.js`, en Vercel ni en este README.

### Paso 2: crear las tablas, políticas y funciones

1. Abre **SQL Editor** en Supabase.
2. Crea una consulta nueva.
3. Pega y ejecuta el siguiente script completo.

```sql
CREATE TABLE IF NOT EXISTS public.evaluaciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo TEXT UNIQUE NOT NULL,
  titulo TEXT NOT NULL,
  curso TEXT NOT NULL,
  duracion_minutos INTEGER DEFAULT 40,
  preguntas_por_intento INTEGER DEFAULT 20,
  intentos_permitidos INTEGER DEFAULT 2,
  activa BOOLEAN DEFAULT TRUE,
  preguntas JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.resultados (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  evaluacion_codigo TEXT REFERENCES public.evaluaciones(codigo) ON DELETE CASCADE,
  curso TEXT NOT NULL,
  estudiante_nombre TEXT NOT NULL,
  estudiante_documento TEXT NOT NULL,
  intentos_realizados INTEGER DEFAULT 1,
  ultimo_puntaje NUMERIC(3,2) NOT NULL,
  mejor_puntaje NUMERIC(3,2) NOT NULL,
  porcentaje NUMERIC(5,2) NOT NULL,
  infracciones_count INTEGER DEFAULT 0,
  log_infracciones JSONB DEFAULT '[]'::jsonb,
  desglose_modulos JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(evaluacion_codigo, estudiante_documento)
);

ALTER TABLE public.evaluaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resultados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Estudiantes leen evaluaciones activas" ON public.evaluaciones;
DROP POLICY IF EXISTS "Docente gestiona evaluaciones" ON public.evaluaciones;
DROP POLICY IF EXISTS "Docente gestiona resultados" ON public.resultados;

CREATE POLICY "Estudiantes leen evaluaciones activas"
  ON public.evaluaciones FOR SELECT TO anon
  USING (activa = true);

CREATE POLICY "Docente gestiona evaluaciones"
  ON public.evaluaciones FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Docente gestiona resultados"
  ON public.resultados FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.consultar_intentos(
  p_codigo TEXT,
  p_documento TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg RECORD;
BEGIN
  SELECT intentos_realizados, ultimo_puntaje, mejor_puntaje,
         infracciones_count, desglose_modulos
    INTO v_reg
    FROM public.resultados
   WHERE evaluacion_codigo = p_codigo
     AND estudiante_documento = p_documento
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(v_reg);
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_resultado(
  p_codigo TEXT,
  p_curso TEXT,
  p_nombre TEXT,
  p_documento TEXT,
  p_nota NUMERIC,
  p_porcentaje NUMERIC,
  p_infracciones JSONB,
  p_desglose JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg public.resultados%ROWTYPE;
  v_infracciones_count INTEGER := jsonb_array_length(COALESCE(p_infracciones, '[]'::jsonb));
BEGIN
  SELECT *
    INTO v_reg
    FROM public.resultados
   WHERE evaluacion_codigo = p_codigo
     AND estudiante_documento = p_documento
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.resultados (
      evaluacion_codigo, curso, estudiante_nombre, estudiante_documento,
      intentos_realizados, ultimo_puntaje, mejor_puntaje, porcentaje,
      infracciones_count, log_infracciones, desglose_modulos
    )
    VALUES (
      p_codigo, p_curso, p_nombre, p_documento, 1, p_nota, p_nota,
      p_porcentaje, v_infracciones_count,
      COALESCE(p_infracciones, '[]'::jsonb),
      COALESCE(p_desglose, '{}'::jsonb)
    )
    RETURNING * INTO v_reg;
  ELSE
    UPDATE public.resultados
       SET curso = p_curso,
           estudiante_nombre = p_nombre,
           intentos_realizados = v_reg.intentos_realizados + 1,
           ultimo_puntaje = p_nota,
           mejor_puntaje = GREATEST(v_reg.mejor_puntaje, p_nota),
           porcentaje = p_porcentaje,
           infracciones_count = v_reg.infracciones_count + v_infracciones_count,
           log_infracciones = COALESCE(v_reg.log_infracciones, '[]'::jsonb)
             || COALESCE(p_infracciones, '[]'::jsonb),
           desglose_modulos = COALESCE(p_desglose, '{}'::jsonb),
           updated_at = NOW()
     WHERE id = v_reg.id
     RETURNING * INTO v_reg;
  END IF;

  RETURN to_jsonb(v_reg);
END;
$$;

GRANT EXECUTE ON FUNCTION public.consultar_intentos(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_resultado(
  TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, JSONB, JSONB
) TO anon, authenticated;
```

La aplicación consulta las evaluaciones activas como usuario anónimo. Los resultados no se exponen mediante una política de lectura pública: el estudiante solo consulta su estado y registra su resultado mediante las funciones RPC anteriores. El docente, una vez autenticado, puede consultar la tabla completa.

### Paso 3: crear el usuario docente

1. Ve a **Authentication > Users**.
2. Selecciona **Add user > Create new user**.
3. Registra el correo y la contraseña del docente.
4. Activa **Auto Confirm User** si la cuenta se administrará directamente desde el panel.
5. En **Authentication > Sign In / Providers**, desactiva **Allow new users to sign up** para impedir registros externos.

## 4. Preparar una evaluación

El docente carga un archivo `.json` desde la pestaña **Cargar nueva evaluación**. Debe contener esta estructura:

```json
{
  "tituloEvaluacion": "Fundamentos de JavaScript",
  "duracionMinutos": 30,
  "preguntasPorIntento": 10,
  "intentosPermitidos": 2,
  "preguntas": [
    {
      "id": "js-001",
      "modulo": "Variables",
      "enunciado": "¿Cuál palabra clave declara una constante?",
      "tipo": "seleccion",
      "opciones": [
        { "i": "a", "t": "const" },
        { "i": "b", "t": "let" }
      ],
      "respuestaCodificada": "YQ=="
    }
  ]
}
```

Cada pregunta requiere `id`, `modulo`, `enunciado`, `opciones` y `respuestaCodificada` válida en Base64. Para preguntas de ordenamiento se utiliza `tipo: "ordenar"` y la aplicación valida el orden de los identificadores. Mantén el banco de preguntas privado: el archivo contiene las respuestas codificadas y debe compartirse únicamente con el docente.

## 5. Configurar y ejecutar en local

### Opción recomendada: `vercel dev`

La aplicación solicita la configuración desde `/api/config`. Por eso, la prueba local más fiel al entorno publicado es ejecutar la función serverless con Vercel.

1. Instala la CLI si aún no la tienes:

   ```bash
   npm install --global vercel
   ```

2. En la raíz del proyecto, crea el archivo `api/config.js` con este contenido:

   ```js
   export default function handler(_request, response) {
     response.setHeader('Cache-Control', 'no-store');
     response.status(200).json({
       SUPABASE_URL: process.env.SUPABASE_URL,
       SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
     });
   }
   ```

   El archivo no debe contener valores reales. La aplicación espera que las variables estén disponibles en el entorno.

3. Crea una copia de la plantilla:

   ```bash
   Copy-Item config.local.example.js config.local.js
   ```

4. Si trabajarás con `vercel dev`, configura las variables mediante:

   ```bash
   vercel env add SUPABASE_URL development
   vercel env add SUPABASE_ANON_KEY development
   ```

   Introduce los valores directamente cuando la CLI los solicite. No los pegues en el README ni en archivos que vayan a Git.

5. Inicia el servidor:

   ```bash
   vercel dev
   ```

6. Abre la URL local indicada por Vercel y comprueba:
   - que aparecen las evaluaciones activas;
   - que el botón **Acceso Docente** permite iniciar sesión;
   - que una evaluación de prueba se guarda en Supabase;
   - que el reporte docente muestra el resultado.

### Alternativa: abrir el HTML directamente

También se puede abrir `index.html` desde el navegador. En ese caso `app.js` intentará cargar `config.local.js` únicamente en `localhost`, `127.0.0.1` o `file://`. Esta opción es útil para una revisión rápida, pero `vercel dev` es preferible porque reproduce el endpoint `/api/config`.

## 6. Publicar en Vercel

1. Sube el proyecto a un repositorio privado o público sin archivos de configuración local.
2. En Vercel selecciona **Add New Project** e importa el repositorio.
3. Mantén el proyecto como sitio estático; no necesitas un comando de build.
4. Añade la función `api/config.js` descrita en la sección anterior.
5. En **Project Settings > Environment Variables**, crea:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
6. Asigna las variables a **Preview** y **Production** según corresponda.
7. Ejecuta el despliegue.
8. Visita la URL de producción y repite la lista de comprobación local.

El archivo `config.local.js` y `.env.local` están excluidos por `.gitignore` y `.vercelignore`. Antes de subir cambios revisa siempre:

```bash
git status
git diff -- . ':!README.md'
```

Si una clave privada se publicó por accidente, revócala y genera una nueva desde Supabase. No intentes ocultarla únicamente con Base64 o con una variable escrita en el frontend.

## 7. Flujo de uso

### Para el docente

1. Inicia sesión desde **Acceso Docente**.
2. Carga el JSON de preguntas.
3. Define el código, el curso, el tiempo, los intentos y el estado inicial.
4. Comparte con los estudiantes el código de la evaluación.
5. Activa o desactiva la evaluación desde **Gestión de evaluaciones**.
6. Revisa las notas, las alertas y el desglose desde **Reporte de calificaciones**.
7. Exporta el resultado filtrado a CSV cuando sea necesario.

### Para el estudiante

1. Selecciona el curso y la evaluación, o escribe el código recibido.
2. Ingresa nombre y documento.
3. Lee las condiciones y comienza la evaluación en pantalla completa.
4. Responde dentro del tiempo disponible.
5. Envía la evaluación y consulta el resultado.

## 8. Datos personales y operación responsable

La aplicación trata nombre, documento, respuestas, calificaciones e indicadores técnicos de integridad con finalidad académica. Antes de usarla en un curso real:

- informa a los estudiantes qué datos se recopilan;
- limita el acceso docente a las personas autorizadas;
- revisa las políticas RLS en cada cambio de esquema;
- define cuánto tiempo conservarás resultados y logs;
- evita descargar o compartir reportes fuera de los canales institucionales.

## 9. Solución de problemas

| Mensaje o síntoma | Revisión |
| --- | --- |
| “Faltan las variables de entorno” | Comprueba `SUPABASE_URL`, `SUPABASE_ANON_KEY` y que `/api/config` responda correctamente. |
| No aparecen evaluaciones | Verifica que exista una fila con `activa = true` y que la política pública de lectura esté creada. |
| El docente no puede iniciar sesión | Confirma que el usuario exista en Supabase Auth y que la contraseña sea correcta. |
| El reporte no carga | Revisa la política para `authenticated` sobre `resultados` y la sesión del docente. |
| El JSON no se puede cargar | Comprueba los campos obligatorios y que `respuestaCodificada` sea Base64 válido. |
| La evaluación no guarda el resultado | Confirma que las funciones `consultar_intentos` y `registrar_resultado` existan y tengan permisos de ejecución. |

## 10. Seguridad de configuración

Los valores reales deben permanecer únicamente en:

- las variables de entorno de Vercel;
- el almacén local de variables de la CLI de Vercel;
- `config.local.js` para una prueba local, sin subirlo al repositorio.

Este README, `config.local.example.js`, el código del navegador y los archivos públicos de Vercel solo deben contener nombres de variables o valores de ejemplo no funcionales.
