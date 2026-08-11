"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui";
import { toggleAutoSendAction, toggleCampaignStatusAction } from "../actions";

interface Props {
  campaignId: string;
  currentStatus: "draft" | "active" | "paused" | "completed" | "archived";
  autoSendEnabled: boolean;
}

export function CampaignControls({ campaignId, currentStatus, autoSendEnabled }: Props) {
  const [pending, startTransition] = useTransition();

  function handleStatusChange(status: "draft" | "active" | "paused" | "archived") {
    startTransition(async () => {
      await toggleCampaignStatusAction(campaignId, status);
    });
  }

  function handleAutoSendToggle() {
    startTransition(async () => {
      await toggleAutoSendAction(campaignId, !autoSendEnabled);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="default"
        size="sm"
        disabled={pending}
        onClick={handleAutoSendToggle}
      >
        {autoSendEnabled ? "Auto-send: ON" : "Auto-send: OFF"}
      </Button>

      {currentStatus === "active" ? (
        <Button
          variant="danger"
          size="sm"
          disabled={pending}
          onClick={() => handleStatusChange("paused")}
        >
          Pause Campaign
        </Button>
      ) : (
        <Button
          variant="primary"
          size="sm"
          disabled={pending}
          onClick={() => handleStatusChange("active")}
        >
          Launch / Activate
        </Button>
      )}
    </div>
  );
}
