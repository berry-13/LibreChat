import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import MCPCardActions from '~/components/SidePanel/MCPBuilder/MCPCardActions';
import ServerInitializationSection from '../ServerInitializationSection';
import MCPConfigDialog from '~/components/Chat/Input/MCPConfigDialog';
import CustomUserVarsSection from '../CustomUserVarsSection';

const mockRevoke = jest.fn();
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useMCPServerManager: () => ({
    getOAuthUrl: () => undefined,
    isCancellable: () => false,
    isInitializing: () => false,
    availableMCPServers: [],
    availableMCPServersMap: {},
    connectionStatus: {},
    revokeOAuthForServer: mockRevoke,
  }),
}));
jest.mock('~/hooks/MCP/useMCPRefresh', () => ({ useMCPRefresh: jest.fn() }));
jest.mock('~/data-provider/Tools/queries', () => ({
  useMCPAuthValuesQuery: () => ({ data: { authValueFlags: {} } }),
}));

const fields = { key: { title: 'Credential', description: '' } };
const surfaces = {
  initialization: <ServerInitializationSection serverName="server" requiresOAuth />,
  card: (
    <MCPCardActions
      serverName="server"
      serverStatus={{ connectionState: 'disconnected', requiresOAuth: true }}
      isInitializing={false}
      canCancel={false}
      hasCustomUserVars={false}
      canEdit={false}
      onEditClick={jest.fn()}
      onConfigClick={jest.fn()}
      onInitialize={jest.fn()}
      onCancel={jest.fn()}
      onRevoke={mockRevoke}
    />
  ),
  configuration: (
    <MCPConfigDialog
      isOpen
      serverName="server"
      fieldsSchema={fields}
      initialValues={{}}
      onSave={jest.fn()}
      onOpenChange={jest.fn()}
      onRevoke={mockRevoke}
    />
  ),
  variables: (
    <CustomUserVarsSection
      serverName="server"
      fields={fields}
      onSave={jest.fn()}
      onRevoke={mockRevoke}
    />
  ),
};

it.each(Object.entries(surfaces))(
  'requires confirmation before revoking from %s',
  (name, surface) => {
    mockRevoke.mockClear();
    render(surface);
    const trigger = screen.getByRole('button', { name: 'com_ui_revoke' });
    const input = screen.queryByLabelText(/Credential/);
    if (input) fireEvent.change(input, { target: { value: 'unsaved' } });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('alertdialog');
    const oauth = name === 'initialization' || name === 'card';
    within(dialog).getByText(oauth ? 'com_ui_mcp_revoke_oauth' : 'com_ui_mcp_revoke_credentials');
    expect(mockRevoke).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'com_ui_cancel' }));
    expect(mockRevoke).not.toHaveBeenCalled();
    if (input) expect(input).toHaveValue('unsaved');
    fireEvent.click(trigger);
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'com_ui_revoke' }),
    );
    expect(mockRevoke).toHaveBeenCalledTimes(1);
  },
);
