import { useMutation, useQuery } from "@tanstack/react-query";
import { File, Upload } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import {
  Button,
  DropZone,
  DropZoneProps,
  FileDropItem,
  FileTrigger,
  FileTriggerProps,
} from "react-aria-components";
import { object, parse, record, string } from "valibot";

interface UploadedItem {
  file: File;
  id: string;
}

export function App() {
  const [locallyUploadedItems, setLocallyUploadedItems] = useState<
    UploadedItem[]
  >([]);

  const handleOnSelect: FileTriggerProps["onSelect"] = (fileList) => {
    if (!fileList) {
      return;
    }

    const newItems = Array.from(fileList).map((newFile) => {
      return { file: newFile, id: crypto.randomUUID() };
    });
    setLocallyUploadedItems([...locallyUploadedItems, ...newItems]);
  };

  const handleOnDrop: DropZoneProps["onDrop"] = ({ items }) => {
    const validDroppedItems = items.filter((item): item is FileDropItem => {
      if (item.kind !== "file") {
        return false;
      }

      if (item.type !== "application/pdf") {
        return false;
      }

      return true;
    });

    Promise.all(validDroppedItems.map((item) => item.getFile()))
      .then((newFiles) => {
        const uploadedItems = newFiles.map((newFile) => {
          return { file: newFile, id: crypto.randomUUID() };
        });
        setLocallyUploadedItems([...uploadedItems, ...uploadedItems]);
      })
      .catch(console.error);
  };

  return (
    <article className={"m-auto max-w-lg py-16 flex flex-col gap-8"}>
      <h1 className={"text-3xl text-center"}>PDF to Prompt</h1>
      <DropZone
        onDrop={handleOnDrop}
        className={
          "h-64 bg-base-300 flex items-center justify-center rounded-md border-neutral border-2 data-[drop-target]:border-info"
        }
      >
        <FileTrigger
          allowsMultiple={false}
          acceptedFileTypes={["application/pdf"]}
          onSelect={handleOnSelect}
        >
          <Button
            className={
              "flex flex-col items-center gap-2 w-full h-full cursor-pointer justify-center"
            }
          >
            <Upload />
            <span
              className={"uppercase font-semibold justify-center select-none"}
            >
              Select document
            </span>
          </Button>
        </FileTrigger>
      </DropZone>
      <section>
        <h2 className={"text-2xl"}>Uploaded documents</h2>
        <FileList locallyUploadedItems={locallyUploadedItems} />
      </section>
    </article>
  );
}

const FileList = ({
  locallyUploadedItems,
}: {
  locallyUploadedItems: UploadedItem[];
}) => {
  return (
    <>
      <ul className={"flex flex-col gap-4 mt-4"}>
        {locallyUploadedItems.map((uploadedItem) => {
          return (
            <LocalFileItem uploadedItem={uploadedItem} key={uploadedItem.id} />
          );
        })}
      </ul>
      <ul></ul>
    </>
  );
};

const uploadedItems = new Set<string>();

const LocalFileItem = ({ uploadedItem }: { uploadedItem: UploadedItem }) => {
  const {
    mutateAsync: uploadItem,
    isPending,
    error,
    data,
    status,
  } = useUploadFile();
  console.log({ isPending, error, data, status });

  /**
   * This hook uploads the file twice. (due to strict mode).
   * How to make it work with correct dependency array, but make sure it is not uploaded twice?
   * Deduplication?
   */
  useLayoutEffect(() => {
    /**
     * Adding the code to prevent this being invoked twice breaks the `isPending` status.
     * Interesting...
     */
    if (uploadedItems.has(uploadedItem.id)) {
      return;
    }

    console.log("uploading!");
    void uploadItem(uploadedItem.file).then(() => {
      console.log("mutation resolved");
    });
    uploadedItems.add(uploadedItem.id);
  }, [uploadItem, uploadedItem.file, uploadedItem.id]);

  return (
    <li className={"p-4 bg-base-300 rounded-md border-2 border-neutral"}>
      <div className={"flex flex-row gap-2"}>
        <File />
        <span className={"italic"}>{uploadedItem.file.name}</span>
        {isPending ? (
          <span className={"ml-auto loading loading-dots loading-sm"}></span>
        ) : null}
      </div>
    </li>
  );
};

const GetUploadUrlResponse = object({
  url: string(),
  fields: record(string()),
});

const useUploadFile = () => {
  return useMutation({
    mutationFn: async (file: File) => {
      const url = new URL("generate-upload-link", import.meta.env.VITE_API_URL);
      const presignedUrlResponse = await fetch(url.toString(), {
        method: "POST",
        body: JSON.stringify({ name: file.name, size: file.size }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (!presignedUrlResponse.ok) {
        throw new Error(await presignedUrlResponse.text());
      }
      const presignedUrlPayload = parse(
        GetUploadUrlResponse,
        await presignedUrlResponse.json()
      );
      console.log("Payload okay");

      const formData = new FormData();
      Object.entries(presignedUrlPayload.fields).forEach(([field, value]) => {
        formData.append(field, value);
      });
      formData.append("file", file);

      const uploadResponse = await fetch(presignedUrlPayload.url, {
        method: "POST",
        body: formData,
      });
      if (!uploadResponse.ok) {
        throw new Error(await uploadResponse.text());
      }

      console.log(uploadResponse);

      return {};
    },
  });
};
