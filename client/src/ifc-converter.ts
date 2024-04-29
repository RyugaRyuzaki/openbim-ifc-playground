import * as OBC from "openbim-components";
import { logger } from "./logger";
import { createStorage } from "./storage";

const WEB_IFC_WASM = "https://unpkg.com/web-ifc@0.0.53/";

type GeometryPartFileId = `ifc-processed-geometries-${number}`;
type GlobalDataFileId = `ifc-processed-global`;
type IfcProcessedFileId = `ifc-processed.json`;

type StreamedGeometries = {
  assets: Array<{
    id: number;
    geometries: Array<{
      color: number[];
      geometryID: number;
      transformation: number[];
    }>;
  }>;
  geometries: {
    [id: number]: {
      boundingBox: Record<number, number>;
      hasHoles: boolean;
      geometryFile: GeometryPartFileId;
    };
  };
  globalDataFileId: GlobalDataFileId;
};

async function convertToStreamable(ifcFile: File) {
  const sourceFileName = ifcFile.name.replace(/\s/g, "_");
  const fileUUID = crypto.randomUUID();
  const saveFile = await createStorage(fileUUID, sourceFileName);

  const converter = new OBC.FragmentIfcStreamConverter(new OBC.Components());
  converter.settings.wasm = {
    path: WEB_IFC_WASM,
    absolute: true,
  };

  let fileIndex = 0;

  const streamedGeometries: StreamedGeometries = {
    assets: [],
    geometries: {},
    globalDataFileId: `ifc-processed-global`,
  };

  converter.onGeometryStreamed.add(async ({ buffer, data }) => {
    const geometryFileId: GeometryPartFileId = `ifc-processed-geometries-${fileIndex}`;
    await saveFile(buffer, geometryFileId);

    for (const id in data) {
      streamedGeometries.geometries[id] = {
        boundingBox: data[id].boundingBox,
        hasHoles: data[id].hasHoles,
        geometryFile: geometryFileId,
      };
    }

    fileIndex++;
  });

  converter.onAssetStreamed.add((assets) => {
    for (const asset of assets) {
      streamedGeometries.assets.push({
        id: asset.id,
        geometries: asset.geometries,
      });
    }
  });

  converter.onIfcLoaded.add(async (globalFile) => {
    await saveFile(globalFile, streamedGeometries.globalDataFileId);
    await saveFile(
      JSON.stringify(streamedGeometries),
      `ifc-processed.json` satisfies IfcProcessedFileId
    );

    logger.success("onIfcLoaded complete");
    logger.info("streamedGeometries", streamedGeometries);

    renderSuccessMessage(fileUUID);
  });

  converter.onProgress.add(handleProgressUpdated);

  converter.streamFromBuffer(new Uint8Array(await ifcFile.arrayBuffer()));
}

/**
 * DOM rendering
 */

export function renderForm() {
  const formEl = document.getElementById("ifcForm") as HTMLFormElement;
  if (!formEl) {
    throw new Error('Element with id "ifcForm" not found');
  }

  const inputEl = document.getElementById("fileInput") as HTMLInputElement;
  if (!inputEl) {
    throw new Error('Element with id "fileInput" not found');
  }

  formEl.addEventListener("submit", (e: SubmitEvent) => {
    e.preventDefault();
    const file = inputEl.files?.[0];
    if (!file) {
      throw new Error("No file selected");
    }
    convertToStreamable(file);
    formEl.reset();
  });
}

function renderSuccessMessage(fileUUID: string) {
  const rootEl = document.getElementById("root") as HTMLDivElement;
  if (!rootEl) {
    throw new Error('Element with id "root" not found');
  }
  rootEl.innerHTML = `
      <p>Files generated and uploaded!</p>
      <p>Change <code>VITE_MODEL_UUID</code> in your <code>.env</code> file. And browse to <a href="/viewer.html">/viewer.html</a>.</p>
      <pre>
VITE_MODEL_UUID="${fileUUID}"
      </pre>
      <p>Refresh the page if you want to convert another file.</p>
    `;
}

function handleProgressUpdated(value: number) {
  const progressEl = document.getElementById("progress") as HTMLProgressElement;
  if (!progressEl) {
    throw new Error('Element with id "progress" not found');
  }
  progressEl.value = value * 100;
  if (value === 1) {
    logger.success("progress 100%");
  }
}
