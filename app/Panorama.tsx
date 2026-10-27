import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Viewer } from "@photo-sphere-viewer/core";
import { MarkersPlugin } from "@photo-sphere-viewer/markers-plugin";
import {
  EquirectangularTilesAdapter,
  type EquirectangularMultiTilesPanorama,
} from "@photo-sphere-viewer/equirectangular-tiles-adapter";
import "@photo-sphere-viewer/core/index.css";
import "@photo-sphere-viewer/markers-plugin/index.css";
import type { Scene, HomeObject, Position, DeviceSnapshot, Role } from "../shared/model.ts";
import type { MediaManifest } from "../server/media.ts";
import { api, mediaUrl, manifestEndpoint } from "./api.ts";
import { deviceForObject, isQuickToggleLight, objectIconMarkup, objectKind } from "./object-presentation.ts";
export type PanoramaHandle = {
  focus: (position: Position) => void;
  snapshot: () => { position: Position; zoom: number };
  restore: (view: { position: Position; zoom: number }) => void;
  position: () => Position;
  zoom: (step: number) => void;
  fullscreen: () => void;
  reset: () => void;
};
type Props = {
  scene: Scene;
  entryView?: { position: Position; zoom: number };
  objects: HomeObject[];
  visible: boolean;
  placing: boolean;
  editing?: boolean;
  devices: DeviceSnapshot | null;
  role: Role;
  onSelect: (id: string) => void;
  onQuickToggle: (id: string) => void;
  onPlace: (position: Position) => void;
  onYaw: (yaw: number) => void;
  onError: (message: string) => void;
  onLoaded?: () => void;
};
const reduced = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const Panorama = forwardRef<PanoramaHandle, Props>(
  function Panorama(props, ref) {
    const container = useRef<HTMLDivElement>(null),
      viewer = useRef<Viewer | null>(null),
      latest = useRef(props),
      markerGesture = useRef({ objectId: "", suppressUntil: 0 }),
      loadedScene = useRef("");
    const [ready, setReady] = useState(false),
      [loading, setLoading] = useState(true),
      [failed, setFailed] = useState(false);
    latest.current = props;
    useImperativeHandle(
      ref,
      () => ({
        focus(position) {
          const v = viewer.current;
          if (!v || !ready) return;
          if (reduced()) {
            v.rotate(position);
            v.zoom(45);
          } else void v.animate({ ...position, zoom: 45, speed: 360 });
        },
        snapshot: () => ({position: viewer.current?.getPosition() ?? props.scene.initial,zoom: viewer.current?.getZoomLevel() ?? 15}),
        restore(view) {const v=viewer.current;if(v&&ready){if(reduced()){v.rotate(view.position);v.zoom(view.zoom);}else void v.animate({...view.position,zoom:view.zoom,speed:360});}},
        position: () => viewer.current?.getPosition() ?? props.scene.initial,
        zoom(step) {
          const v = viewer.current;
          if (v && ready)
            v.zoom(Math.max(0, Math.min(100, v.getZoomLevel() + step)));
        },
        fullscreen() {
          if(document.fullscreenElement)void document.exitFullscreen();else void document.documentElement.requestFullscreen?.();
        },
        reset() {
          const v = viewer.current;
          if (v && ready) {
            v.rotate(props.scene.initial);
            v.zoom(15);
          }
        },
      }),
      [ready, props.scene.initial],
    );
    useEffect(() => {
      const v = new Viewer({
        container: container.current!,
        adapter: [EquirectangularTilesAdapter, { baseBlur: false }],
        navbar: false,
        defaultZoomLvl: 15,
        minFov: 35,
        maxFov: 95,
        keyboard: false,
        mousemove: true,
        moveSpeed: window.matchMedia("(pointer: coarse)").matches ? 1.35 : 1,
        mousewheel: true,
        touchmoveTwoFingers: false,
        plugins: [[MarkersPlugin, { markers: [] }]],
        lang: {
          loading: "Duke hapur hapësirën…",
          loadError: "Panorama nuk u ngarkua.",
        },
      });
      viewer.current = v;
      let pointerMarkerId:string|undefined;
      const rememberPointerTarget=(event:Event)=>{
        pointerMarkerId=event.target instanceof Element?event.target.closest<HTMLButtonElement>('button.world-pin')?.dataset.hotspotId:undefined;
      };
      v.container.addEventListener('touchend',rememberPointerTarget,true);
      v.container.addEventListener('mouseup',rememberPointerTarget,true);
      // The viewer consumes touchend and emits select-marker instead of a DOM
      // click. Use its gesture-aware event for pointer/touch activation.
      v.getPlugin<MarkersPlugin>(MarkersPlugin)!.addEventListener('select-marker', ({marker,rightClick,doubleClick}) => {
        if(rightClick)return;
        // Rapid taps after a scene switch can be classified as a double-click
        // with the previous tap's marker. Resolve that case from this gesture.
        const id=doubleClick?pointerMarkerId:marker.id;
        const hotspot=latest.current.scene.hotspots.find(h=>h.id===id);
        if(!hotspot)return;
        if(markerGesture.current.objectId===hotspot.objectId&&Date.now()<markerGesture.current.suppressUntil)return;
        const object=latest.current.objects.find(item=>item.id===hotspot.objectId);
        const device=object?deviceForObject(object,latest.current.devices):undefined;
        if(object&&isQuickToggleLight(object,device,latest.current.role))latest.current.onQuickToggle(object.id);
        else latest.current.onSelect(hotspot.objectId);
      });
      v.addEventListener('dblclick',event=>{
        // A removed marker from the first tap can prevent the plugin from
        // recognizing the second tap at all. Its uncaptured event lands here.
        if(event.data.rightclick)return;
        const hotspot=latest.current.scene.hotspots.find(h=>h.id===pointerMarkerId);
        if(hotspot)latest.current.onSelect(hotspot.objectId);
      });
      v.addEventListener("click", (event) => {
        if (latest.current.placing || latest.current.editing)
          latest.current.onPlace({
            yaw: event.data.yaw,
            pitch: event.data.pitch,
          });
      });
      v.addEventListener("position-updated", (event) =>
        latest.current.onYaw(event.position.yaw),
      );
      v.addEventListener("panorama-error", () => {
        setFailed(true);
        latest.current.onError(
          "Panorama nuk u ngarkua. Kontrolloni mediat lokale.",
        );
      });
      return () => {
        v.container.removeEventListener('touchend',rememberPointerTarget,true);
        v.container.removeEventListener('mouseup',rememberPointerTarget,true);
        v.destroy();
        viewer.current = null;
      };
    }, []);
    useEffect(() => {
      let cancelled = false;
      setLoading(true);
      setFailed(false);
      setReady(false);
      const load = async () => {
        const manifest = await api<MediaManifest>(
          manifestEndpoint(props.scene.mediaId),
        );
        if (cancelled) return;
        const panorama: EquirectangularMultiTilesPanorama = {
          baseUrl: mediaUrl(props.scene.mediaId),
          levels: manifest.levels,
          tileUrl: (col, row, level) =>
            mediaUrl(props.scene.mediaId, `${level}-${col}-${row}.jpg`),
        };
        const v = viewer.current;
        if (!v) return;
        const result = await v.setPanorama(panorama, {
          position:
            loadedScene.current === props.scene.id
              ? v.getPosition()
              : props.entryView?.position ?? props.scene.initial,
          zoom: props.entryView?.zoom ?? 15,
          transition: reduced()
            ? false
            : { speed: 280, rotation: false, effect: "fade" },
        });
        if (cancelled) return;
        if (!result) throw Error("LOAD_CANCELLED");
        loadedScene.current = props.scene.id;
        setReady(true);
        setLoading(false);
        latest.current.onLoaded?.();
      };
      void load().catch(() => {
        if (!cancelled) {
          setLoading(false);
          setFailed(true);
          props.onError("Nuk u hap panorama. Rifreskoni dhe provoni sërish.");
        }
      });
      return () => {
        cancelled = true;
      };
      // Scene media changes reload the photograph; hotspot changes only update markers.
    }, [props.scene.id, props.scene.mediaId]);
    useEffect(() => {
      if (!ready || !viewer.current) return;
      const markers = viewer.current.getPlugin<MarkersPlugin>(MarkersPlugin)!;
      markers.setMarkers(
        props.scene.hotspots.flatMap((hotspot) => {
          const object = props.objects.find((o) => o.id === hotspot.objectId);
          if (!object) return [];
          const portal = object.actions.some((a) => a.type === "portal"),
            device = deviceForObject(object, props.devices),
            kind = objectKind(object),
            quickToggle = isQuickToggleLight(object, device, props.role);
          const button = document.createElement("button");
          button.className = `world-pin kind-${kind} ${portal ? "portal-pin" : ""} ${device ? `device-${device.state}` : ""}`;
          button.type = "button";
          button.dataset.hotspotId=hotspot.id;
          const state=device?.state==='on'?'Ndezur':device?.state==='off'?'Fikur':device?'Pa gjendje':'';
          button.setAttribute("aria-label", `${object.name}${state?` · ${state}`:''}${quickToggle?' · Prek për ON/OFF; mbaje për kontrolle':''}`);
          const symbol = document.createElement("span");
          symbol.className = "pin-symbol";
          symbol.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${objectIconMarkup[kind]}</svg>`;
          const label = document.createElement("span");
          label.className = "pin-label";
          label.textContent = `${object.name}${state?` · ${state}`:''}`;
          button.append(symbol, label);
          let pressTimer:number|undefined;
          let pressStart:{x:number;y:number}|undefined;
          const cancelPress=()=>{if(pressTimer!==undefined){window.clearTimeout(pressTimer);pressTimer=undefined;}};
          button.addEventListener('pointerdown',event=>{
            if(event.pointerType==='mouse'&&event.button!==0)return;
            cancelPress();
            pressStart={x:event.clientX,y:event.clientY};
            if(event.pointerId>=0)try{button.setPointerCapture(event.pointerId);}catch{/* Synthetic accessibility activation has no active pointer to capture. */}
            pressTimer=window.setTimeout(()=>{
              markerGesture.current={objectId:object.id,suppressUntil:Date.now()+900};
              latest.current.onSelect(object.id);
              pressTimer=undefined;
            },520);
          });
          button.addEventListener('pointermove',event=>{
            if(pressStart&&Math.hypot(event.clientX-pressStart.x,event.clientY-pressStart.y)>8){
              cancelPress();
              markerGesture.current={objectId:object.id,suppressUntil:Date.now()+900};
            }
          });
          const endPress=()=>{cancelPress();pressStart=undefined;};
          button.addEventListener('pointerup',endPress);
          button.addEventListener('pointercancel',endPress);
          button.addEventListener('pointerleave',endPress);
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            // Enter/Space and assistive activation have no pointer gesture.
            // Pointer clicks already ran through select-marker; don't run twice.
            if(event.detail===0)latest.current.onSelect(object.id);
          });
          return [
            {
              id: hotspot.id,
              position: hotspot.position,
              element: button,
              anchor: "center center",
              size: { width: 44, height: 44 },
            },
          ];
        }),
      );
      if (props.visible) markers.showAllMarkers();
      else markers.hideAllMarkers();
    }, [ready, props.scene.hotspots, props.objects, props.visible, props.devices, props.role]);
    return (
      <div className={`world ${props.placing ? "placing" : ""}`}>
        <div
          className="panorama"
          ref={container}
          role="region"
          tabIndex={0}
          onKeyDown={event=>{if(event.target!==event.currentTarget)return;const v=viewer.current;if(!v)return;const pos=v.getPosition();const delta=.12;switch(event.key){case "Home":v.rotate(props.scene.initial);v.zoom(15);break;case "ArrowLeft":v.rotate({...pos,yaw:pos.yaw-delta});break;case "ArrowRight":v.rotate({...pos,yaw:pos.yaw+delta});break;case "ArrowUp":v.rotate({...pos,pitch:Math.min(Math.PI/2,pos.pitch+delta)});break;case "ArrowDown":v.rotate({...pos,pitch:Math.max(-Math.PI/2,pos.pitch-delta)});break;case "+":case "=":v.zoom(Math.min(100,v.getZoomLevel()+10));break;case "-":v.zoom(Math.max(0,v.getZoomLevel()-10));break;default:return;}event.preventDefault();}}
          aria-label={`Panoramë 360°: ${props.scene.name}. Tërhiqni ose përdorni shigjetat dhe +/− në tastierë.`}
        />
        {loading && (
          <div className="world-loading" role="status">
            <span className="loader-ring" />
            Duke hapur hapësirën…
          </div>
        )}
        {failed && (
          <div className="world-loading" role="alert">
            Panorama nuk u ngarkua.
            <button onClick={() => location.reload()}>Riprovo</button>
          </div>
        )}
      </div>
    );
  },
);
