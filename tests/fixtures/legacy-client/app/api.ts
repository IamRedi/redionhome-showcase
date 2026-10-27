export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: { path: string }[] = [],
  ) {
    super(code);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!response.ok) {
    const error = (await response
      .json()
      .catch(() => ({ error: "NETWORK_ERROR" }))) as { error: string; details?: unknown };
    const details = Array.isArray(error.details)
      ? error.details.flatMap((detail) => {
          if (!detail || typeof detail !== "object") return [];
          const path = (detail as { path?: unknown }).path;
          return typeof path === "string" && path.length <= 300 ? [{ path }] : [];
        })
      : [];
    throw new ApiError(response.status, error.error, details);
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}
export const mediaUrl = (id: string, file = "preview.jpg") =>
  tourId ? `/api/v1/tours/${tourId}/media/${encodeURIComponent(id)}/${file}` : `/api/v1/media/${encodeURIComponent(id)}/${file}`;
export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "INVALID_INPUT" && error.details.length) {
      const paths = error.details.map((detail) => detail.path);
      if (paths.some((path) => path.endsWith(".position.yaw")))
        return "Kontrolloni koordinatën Yaw: lejohet nga -360° deri në 360°.";
      if (paths.some((path) => path.endsWith(".position.pitch")))
        return "Kontrolloni koordinatën Pitch: lejohet nga -90° deri në 90°.";
      if (paths.some((path) => path.endsWith(".url") || path.endsWith(".fallbackUrl")))
        return "Kontrolloni linkun: pa kredenciale (user:pass). Lidhja publike duhet HTTPS publik; lidhja private lejon edhe http lokal, porta, query dhe fragment.";
      if (paths.some((path) => path.endsWith(".name") || path.endsWith(".title")))
        return "Kontrolloni emrin ose titullin e fushës së shënuar.";
      if (paths.some((path) => path.includes(".detailPosition.")))
        return "Kontrolloni pozicionin mbi fotografi: vlerat duhet të jenë nga 0% deri në 100%.";
    }
    const messages: Record<string, string> = {
      INVITATION_INVALID: "Ftesa ka skaduar ose është revokuar.",
      SESSION_LIMIT: "U arrit kufiri i sesioneve për këtë ftesë.",
      TOUR_NOT_ALLOWED: "Kjo përvojë nuk është e disponueshme për ju.",
      INVALID_SELECTION: "Zgjidhni vetëm skena, objekte dhe media të lejuara për këtë audiencë.",
      UNSAFE_EXPORT_TEXT: "Përmbajtja përmban adresa lokale ose të dhëna që nuk duhen ndarë.",
      INVALID_MEDIA: "Media nuk mbështetet. Përdorni foto JPEG/PNG/WebP ose video MP4 deri 120 sekonda.",
      INVALID_PANORAMA: 'Zgjidhni panoramë 360° JPEG/PNG/WebP me raport 2:1, gjerësi të paktën 2048 px dhe deri 150 megapikselë.',
      PANORAMA_ORIENTATION: 'Eksportojeni panoramën drejt, pa rrotullim EXIF, pastaj provojeni përsëri.',
      PANORAMA_FORMAT: 'Përdorni një panoramë të vetme JPEG, PNG ose WebP; animacionet nuk mbështeten.',
      INVALID_DOCUMENT: 'Përdorni PDF të pakriptuar deri 20 faqe (10 MB) ose tekst UTF-8 deri 2 MB. Përmbajtja aktive hiqet nga kopja e PDF-së.',
      AI_UNCONFIGURED: 'Asistenti AI nuk është konfiguruar. Mund të plotësoni gjithçka vetë.',
      AI_TIMEOUT: 'AI nuk u përgjigj në kohë. Drafti juaj mbeti; provoni përsëri ose plotësoni vetë.',
      AI_REFUSED: 'AI nuk propozoi të dhëna për këtë foto. Drafti juaj mbeti.',
      AI_FAILED: 'Sugjerimi AI nuk u përgatit. Drafti juaj mbeti.',
      AI_PHOTO_REQUIRED: 'Zgjidhni një fotografi nga afër të objektit, jo panoramën ose videon.',
      AI_CONFIRMATION_REQUIRED: 'Shqyrtoni dhe miratoni sugjerimin AI para ruajtjes.',
      AI_PHOTO_CONSENT_REQUIRED: 'Miratoni dërgimin e fotos para analizës.',
      AI_AUTH_FAILED: 'OpenAI e refuzoi çelësin. Krijoni ose rrotulloni çelësin e projektit RediOnHome.',
      AI_RATE_LIMITED: 'U arrit kufiri i përkohshëm i OpenAI. Prisni pak dhe provoni përsëri.',
      AI_BUSY: 'AI po përpunon një kërkesë tjetër. Prisni përfundimin e saj.',
      AI_SUGGESTION_NOT_FOUND: 'Sugjerimi AI nuk u gjet ose nuk është më i vlefshëm.',
      IMPORT_BUSY: 'Një panoramë tjetër po përpunohet. Prisni dhe zgjidhni Riprovo.',
      IMPORT_EXPIRED: 'Përpunimi u ndërpre ose skadoi. Drafti mbeti; zgjidhni skedarin dhe provoni përsëri.',
      MEDIA_TOO_LARGE: "Skedari duhet të jetë më i vogël se 30 MB.",
      INVALID_CREDENTIALS: "Fjalëkalimi nuk është i saktë.",
      AUTH_REQUIRED: "Sesioni përfundoi. Hyni përsëri.",
      OWNER_REQUIRED: "Ky veprim kërkon rolin pronar.",
      REVISION_CONFLICT:
        "Konfigurimi ndryshoi në një sesion tjetër. Drafti juaj mbeti. Ngarkoni versionin e fundit dhe shqyrtoni ndryshimet para ruajtjes.",
      UNKNOWN_BINDING: "Pajisja nuk ka lidhje të autorizuar.",
      REAL_COMMANDS_PHASE_2_LOCKED: "Komandat reale nuk janë aktivizuar.",
      DEVICE_UNAVAILABLE: "Pajisja është e padisponueshme.",
      HA_ORIGIN_INVALID: "Adresa e Home Assistant nuk është e vlefshme.",
      HA_ORIGIN_NOT_ALLOWED: "Adresa nuk është në listën e lejuar të backend-it.",
      HA_TOKEN_UNCONFIGURED: "Tokeni privat i backend-it nuk është konfiguruar.",
      HA_TOKEN_FILE_UNSAFE: "Skedari i tokenit duhet të jetë privat (0600).",
      HA_AUTH_FAILED: "Home Assistant e refuzoi tokenin. Kontrollojeni në backend.",
      HA_UNAVAILABLE: "Home Assistant nuk është i arritshëm tani.",
      HA_DUPLICATE_PROVIDER: "Ekziston tashmë një lidhje Home Assistant me adresë tjetër.",
      HA_IDENTITY_CONFLICT: "Kjo dritë ose ky objekt është lidhur tashmë.",
      HA_BINDING_MANAGED: "Ndryshimi prek lidhjen reale ose heq hotspot-in e saj. Përdorni “Menaxho lidhjen reale”; përmbajtja mund të redaktohet pa shkëputje.",
      HA_OBJECT_NEEDS_HOTSPOT: "Objekti duhet të ketë një hotspot në panoramë.",
      HA_ENTITY_NOT_DISCOVERED: "Drita nuk u gjet në zbulimin e fundit.",
      HA_LIGHT_NOT_APPROVED: "Kjo dritë nuk është autorizuar për komandë fizike në backend.",
      HA_CONFIRM_ENTITY: "Konfirmoni entitetin e saktë para komandës.",
      HA_STATE_NOT_CONFIRMED: "Home Assistant pranoi komandën, por gjendja e kërkuar nuk u konfirmua.",
      ST_AUTH_BLOCKED: "Lidhja SmartThings OAuth pret regjistrimin zyrtar të aplikacionit dhe callback të miratuar.",
      ST_AUTH_REQUIRED: "Kredenciali diagnostik SmartThings mungon, ka skaduar ose nuk ka leje leximi.",
      ST_TOKEN_FILE_UNSAFE: "Skedari privat SmartThings duhet të ketë leje 0600.",
      ST_RATE_LIMITED: "SmartThings kufizoi kërkesat. Provoni më vonë.",
      ST_UNAVAILABLE: "SmartThings nuk është i arritshëm tani.",
      ST_DEVICE_NOT_DISCOVERED: "Pajisja nuk është në discovery e autorizuar.",
      ST_CAPABILITY_UNSUPPORTED: "Kjo pajisje nuk raporton gjendje switch në SmartThings API.",
      TUYA_AUTH_BLOCKED: "Smart Life/Tuya pret lidhjen e llogarisë me projektin dhe konfigurimin privat backend.",
      TUYA_CONFIG_UNSAFE: "Skedari privat Tuya duhet të ketë leje 0600.",
      TUYA_CONFIG_MISSING: "Konfigurimi privat Tuya mungon.",
      TUYA_AUTH_REQUIRED: "Tuya nuk pranoi kredencialet ose lidhjen e llogarisë.",
      TUYA_API_REJECTED: "Tuya nuk lejoi këtë kërkesë; kontrolloni rajonin, UID dhe shërbimet e projektit.",
      TUYA_RATE_LIMITED: "Tuya kufizoi kërkesat. Provoni më vonë.",
      TUYA_UNAVAILABLE: "Tuya nuk është i arritshëm tani.",
      TUYA_DEVICE_NOT_DISCOVERED: "Pajisja nuk është në discovery e autorizuar Tuya.",
      TUYA_CAPABILITY_UNSUPPORTED: "Kjo pajisje nuk raporton një gjendje switch të qartë.",
      DEVICE_IDENTITY_CONFLICT: "Kjo pajisje është lidhur tashmë me një objekt tjetër.",
      DEVICE_OBJECT_ALREADY_BOUND: "Objekti ka një lidhje aktive që duhet shqyrtuar.",
      DEVICE_OBJECT_NEEDS_HOTSPOT: "Objekti duhet të ketë hotspot në panoramë.",
      DEVICE_CONFIRMATION_REQUIRED: "Konfirmoni identitetin fizik para lidhjes.",
      INVALID_INPUT: "Kontrolloni fushat e shënuara; drafti juaj nuk është humbur.",
      UNKNOWN_MEDIA: "Media nuk është importuar.",
      VIDEO_IMPORT_PLANNED: "Importimi i videos nuk është aktivizuar ende.",
    };
    return messages[error.code] ?? "Kërkesa nuk u krye. Provoni përsëri.";
  }
  return "Lidhja nuk është e disponueshme. Provoni përsëri.";
}

export const tourId = /^\/tour\/([\w-]{1,80})\/?$/.exec(window.location.pathname)?.[1];
export const homeEndpoint = tourId ? `/tours/${tourId}/home` : '/home';
export const manifestEndpoint = (id: string) => tourId ? `/tours/${tourId}/media/${encodeURIComponent(id)}/manifest` : `/media/${encodeURIComponent(id)}/manifest`;
export async function uploadMedia(file:File,kind:'photo'|'video'):Promise<{id:string;kind:string}>{
 const response=await fetch(`/api/v1/uploads?kind=${kind}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file,credentials:'same-origin'});
 if(!response.ok){const data=await response.json();throw new ApiError(response.status,data.error);}
 return response.json();
}

export function uploadBinary<T>(file:File,url:string,signal:AbortSignal,onProgress:(value:number)=>void):Promise<T>{
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();
  const abort=()=>xhr.abort();
  xhr.open('POST',`/api/v1${url}`);xhr.withCredentials=true;xhr.setRequestHeader('Content-Type','application/octet-stream');
  xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.round(e.loaded/e.total*100));};
  const cleanup=()=>signal.removeEventListener('abort',abort);
  xhr.onload=()=>{cleanup();let data;try{data=JSON.parse(xhr.responseText);}catch{reject(new Error('NETWORK_ERROR'));return;}
   if(xhr.status>=200&&xhr.status<300)resolve(data as T);else reject(new ApiError(xhr.status,data.error??'NETWORK_ERROR'));
  };
  xhr.onerror=()=>{cleanup();reject(new Error('NETWORK_ERROR'));};
  xhr.onabort=()=>{cleanup();reject(new DOMException('Upload cancelled','AbortError'));};
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted){cleanup();reject(new DOMException('Upload cancelled','AbortError'));return;}
  xhr.send(file);
 });
}
