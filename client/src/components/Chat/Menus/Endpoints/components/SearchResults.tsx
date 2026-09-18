import React, { Fragment, useCallback, useMemo } from 'react';
import { VisuallyHidden } from '@ariakit/react';
import { CheckCircle2, EarthIcon } from 'lucide-react';
import { isAgentsEndpoint, isAssistantsEndpoint } from 'librechat-data-provider';
import type { TModelSpec } from 'librechat-data-provider';
import type { Endpoint } from '~/common';
import MarketplaceItem, { marketplaceSearchMatches } from './Marketplace';
import { useModelSelectorContext } from '../ModelSelectorContext';
import { CustomMenuItem as MenuItem } from '../CustomMenu';
import { VIRTUALIZE_THRESHOLD } from './EndpointModelItem';
import VirtualizedModelList from './VirtualizedModelList';
import { shouldRenderEndpointOption } from '../utils';
import { cn, getSpecAgentAvatarURL } from '~/utils';
import SpecDescription from './SpecDescription';
import { useFavorites } from '~/hooks';
import SpecIcon from './SpecIcon';

type SearchModel = { name: string; isGlobal?: boolean };

/**
 * Windowed rows for a search that matches more models than can be mounted cheaply
 * (the agents endpoint at catalog scale). Kept as its own component so `useFavorites`
 * — which opens several store subscriptions — only runs when virtualization is needed.
 */
function VirtualizedSearchModels({
  endpoint,
  filteredModels,
  precedingOptionCount,
}: {
  endpoint: Endpoint;
  filteredModels: SearchModel[];
  precedingOptionCount: number;
}) {
  const { isFavoriteModel, toggleFavoriteModel, isFavoriteAgent, toggleFavoriteAgent } =
    useFavorites();
  const isAgent = isAgentsEndpoint(endpoint.value);

  const isFavorite = useCallback(
    (modelId: string) =>
      isAgent ? isFavoriteAgent(modelId) : isFavoriteModel(modelId, endpoint.value),
    [isAgent, isFavoriteAgent, isFavoriteModel, endpoint.value],
  );
  const onToggleFavorite = useCallback(
    (modelId: string) => {
      if (isAgent) {
        toggleFavoriteAgent(modelId);
      } else {
        toggleFavoriteModel({ model: modelId, endpoint: endpoint.value });
      }
    },
    [isAgent, toggleFavoriteAgent, toggleFavoriteModel, endpoint.value],
  );

  const modelIds = useMemo(() => filteredModels.map((model) => model.name), [filteredModels]);
  const globalByName = useMemo(
    () => new Map(filteredModels.map((model) => [model.name, model.isGlobal ?? false])),
    [filteredModels],
  );

  return (
    <VirtualizedModelList
      endpoint={endpoint}
      modelIds={modelIds}
      globalByName={globalByName}
      isFavorite={isFavorite}
      onToggleFavorite={onToggleFavorite}
      precedingOptionCount={precedingOptionCount}
    />
  );
}

interface SearchResultsProps {
  results: (TModelSpec | Endpoint)[] | null;
  localize: (phraseKey: any, options?: any) => string;
  searchValue: string;
}

export function SearchResults({ results, localize, searchValue }: SearchResultsProps) {
  const {
    selectedValues,
    handleSelectSpec,
    handleSelectModel,
    handleSelectEndpoint,
    endpointsConfig,
    agentsMap,
  } = useModelSelectorContext();

  const {
    modelSpec: selectedSpec,
    endpoint: selectedEndpoint,
    model: selectedModel,
  } = selectedValues;

  if (!results) {
    return null;
  }
  if (!results.length) {
    return (
      <>
        <div role="alert" aria-live="polite" className="sr-only">
          {localize('com_files_no_results')}
        </div>
        <div className="cursor-default p-2 sm:py-1 sm:text-sm">
          {localize('com_files_no_results')}
        </div>
      </>
    );
  }

  return (
    <>
      <div role="alert" aria-live="polite" className="sr-only">
        {results.length === 1
          ? localize('com_files_result_found', { count: results.length })
          : localize('com_files_results_found', { count: results.length })}
      </div>
      {results.map((item) => {
        if ('name' in item && 'label' in item) {
          // Render model spec
          const spec = item as TModelSpec;
          return (
            <MenuItem
              key={spec.name}
              onClick={() => handleSelectSpec(spec)}
              aria-selected={selectedSpec === spec.name || undefined}
              className={cn(
                'flex w-full cursor-pointer justify-between rounded-lg px-2 text-sm',
                spec.description ? 'items-start' : 'items-center',
              )}
            >
              <div
                className={cn(
                  'flex w-full min-w-0 gap-2 px-1 py-1',
                  spec.description ? 'items-start' : 'items-center',
                )}
              >
                {(spec.showIconInMenu ?? true) && (
                  <div className="flex-shrink-0">
                    <SpecIcon
                      currentSpec={spec}
                      endpointsConfig={endpointsConfig}
                      agentAvatarURL={getSpecAgentAvatarURL(spec, agentsMap)}
                    />
                  </div>
                )}
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-left">{spec.label}</span>
                  <SpecDescription description={spec.description} />
                </div>
              </div>
              {selectedSpec === spec.name && (
                <>
                  <CheckCircle2
                    className={cn(
                      'size-4 shrink-0 text-text-primary',
                      spec.description ? 'mt-1' : '',
                    )}
                    aria-hidden="true"
                  />
                  <VisuallyHidden>{localize('com_a11y_selected')}</VisuallyHidden>
                </>
              )}
            </MenuItem>
          );
        } else {
          // For an endpoint item
          const endpoint = item as Endpoint;
          if (!shouldRenderEndpointOption(endpoint)) {
            return null;
          }

          if (endpoint.hasModels) {
            const lowerQuery = searchValue.toLowerCase();
            const endpointMatches = endpoint.label.toLowerCase().includes(lowerQuery);
            const showMarketplace =
              endpoint.showMarketplace === true &&
              (endpointMatches || marketplaceSearchMatches(searchValue, localize));
            const models = endpoint.models ?? [];
            const filteredModels = endpointMatches
              ? models
              : models.filter((model) => {
                  let modelName = model.name;
                  if (
                    isAgentsEndpoint(endpoint.value) &&
                    endpoint.agentNames &&
                    endpoint.agentNames[model.name]
                  ) {
                    modelName = endpoint.agentNames[model.name];
                  } else if (
                    isAssistantsEndpoint(endpoint.value) &&
                    endpoint.assistantNames &&
                    endpoint.assistantNames[model.name]
                  ) {
                    modelName = endpoint.assistantNames[model.name];
                  }
                  return modelName.toLowerCase().includes(lowerQuery);
                });

            if (!filteredModels.length && !showMarketplace) {
              return null; // skip if no models match
            }

            const isVirtualized = filteredModels.length > VIRTUALIZE_THRESHOLD;

            return (
              <Fragment key={`endpoint-${endpoint.value}-search`}>
                <div className="flex items-center gap-2 px-3 py-1 text-sm font-medium">
                  {endpoint.icon && (
                    <div className="flex items-center justify-center overflow-hidden rounded-full p-1">
                      {endpoint.icon}
                    </div>
                  )}
                  {endpoint.label}
                </div>
                {showMarketplace && (
                  <MarketplaceItem
                    className="px-3 py-2 pl-6"
                    label={localize('com_agents_marketplace')}
                  />
                )}
                {isVirtualized && (
                  <VirtualizedSearchModels
                    key={searchValue}
                    endpoint={endpoint}
                    filteredModels={filteredModels}
                    precedingOptionCount={showMarketplace ? 1 : 0}
                  />
                )}
                {!isVirtualized &&
                  filteredModels.map((model) => {
                    const modelId = model.name;

                    let isGlobal = false;
                    let modelName = modelId;
                    if (
                      isAgentsEndpoint(endpoint.value) &&
                      endpoint.agentNames &&
                      endpoint.agentNames[modelId]
                    ) {
                      modelName = endpoint.agentNames[modelId];
                      isGlobal = model.isGlobal ?? false;
                    } else if (
                      isAssistantsEndpoint(endpoint.value) &&
                      endpoint.assistantNames &&
                      endpoint.assistantNames[modelId]
                    ) {
                      modelName = endpoint.assistantNames[modelId];
                    }

                    const isModelSelected =
                      !selectedSpec &&
                      selectedEndpoint === endpoint.value &&
                      selectedModel === modelId;
                    return (
                      <MenuItem
                        key={`${endpoint.value}-${modelId}-search`}
                        onClick={() => handleSelectModel(endpoint, modelId)}
                        aria-selected={isModelSelected || undefined}
                        className="flex w-full cursor-pointer items-center justify-start rounded-lg px-3 py-2 pl-6 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          {endpoint.modelIcons?.[modelId] && (
                            <div className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full">
                              <img
                                src={endpoint.modelIcons[modelId]}
                                alt={modelName}
                                className="h-full w-full object-cover"
                              />
                            </div>
                          )}
                          <span>{modelName}</span>
                        </div>
                        {isGlobal && (
                          <EarthIcon
                            className="ml-auto size-4 text-accent-primary"
                            aria-hidden="true"
                          />
                        )}
                        {isModelSelected && (
                          <>
                            <CheckCircle2
                              className="size-4 shrink-0 text-text-primary"
                              aria-hidden="true"
                            />
                            <VisuallyHidden>{localize('com_a11y_selected')}</VisuallyHidden>
                          </>
                        )}
                      </MenuItem>
                    );
                  })}
              </Fragment>
            );
          } else {
            // Endpoints with no models
            const isEndpointSelected = !selectedSpec && selectedEndpoint === endpoint.value;
            return (
              <MenuItem
                key={`endpoint-${endpoint.value}-search-item`}
                onClick={() => handleSelectEndpoint(endpoint)}
                aria-selected={isEndpointSelected || undefined}
                className="flex w-full cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  {endpoint.icon && (
                    <div
                      className="flex items-center justify-center overflow-hidden rounded-full border border-border-light p-1"
                      style={{ borderRadius: '50%' }}
                    >
                      {endpoint.icon}
                    </div>
                  )}
                  <span>{endpoint.label}</span>
                </div>
                {isEndpointSelected && (
                  <>
                    <CheckCircle2
                      className="size-4 shrink-0 text-text-primary"
                      aria-hidden="true"
                    />
                    <VisuallyHidden>{localize('com_a11y_selected')}</VisuallyHidden>
                  </>
                )}
              </MenuItem>
            );
          }
        }
      })}
    </>
  );
}

export function renderSearchResults(
  results: (TModelSpec | Endpoint)[] | null,
  localize: (phraseKey: any, options?: any) => string,
  searchValue: string,
) {
  return (
    <SearchResults
      key="search-results"
      results={results}
      localize={localize}
      searchValue={searchValue}
    />
  );
}
