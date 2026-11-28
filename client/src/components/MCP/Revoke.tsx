import React from 'react';
import {
  Button,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@librechat/client';
import { useLocalize } from '~/hooks';

export default function Revoke({
  serverName,
  kind,
  onConfirm,
  children,
}: {
  serverName: string;
  kind: 'oauth' | 'credentials';
  onConfirm: () => void;
  children: React.ReactElement;
}) {
  const localize = useLocalize();
  return (
    <AlertDialog key={serverName}>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent className="w-11/12 max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {localize('com_ui_mcp_revoke_title', { 0: serverName })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {localize(
              kind === 'oauth' ? 'com_ui_mcp_revoke_oauth' : 'com_ui_mcp_revoke_credentials',
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline">
              {localize('com_ui_cancel')}
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button type="button" variant="destructive" onClick={onConfirm}>
              {localize('com_ui_revoke')}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
