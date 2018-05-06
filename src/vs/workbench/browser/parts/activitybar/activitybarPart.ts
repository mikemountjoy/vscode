/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./media/activitybarpart';
import * as nls from 'vs/nls';
import { illegalArgument } from 'vs/base/common/errors';
import { $ } from 'vs/base/browser/builder';
import { ActionsOrientation, ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { GlobalActivityExtensions, IGlobalActivityRegistry } from 'vs/workbench/common/activity';
import { Registry } from 'vs/platform/registry/common/platform';
import { Part } from 'vs/workbench/browser/part';
import { GlobalActivityActionItem, GlobalActivityAction, ViewletActivityAction, ToggleViewletAction } from 'vs/workbench/browser/parts/activitybar/activitybarActions';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IBadge } from 'vs/workbench/services/activity/common/activity';
import { IPartService, Parts, Position as SideBarPosition } from 'vs/workbench/services/part/common/partService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ToggleActivityBarVisibilityAction } from 'vs/workbench/browser/actions/toggleActivityBarVisibility';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ACTIVITY_BAR_BACKGROUND, ACTIVITY_BAR_BORDER, ACTIVITY_BAR_FOREGROUND, ACTIVITY_BAR_BADGE_BACKGROUND, ACTIVITY_BAR_BADGE_FOREGROUND, ACTIVITY_BAR_DRAG_AND_DROP_BACKGROUND } from 'vs/workbench/common/theme';
import { contrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { CompositeBar } from 'vs/workbench/browser/parts/compositebar/compositeBar';
import { ToggleCompositePinnedAction } from 'vs/workbench/browser/parts/compositebar/compositeBarActions';
import { ViewLocation, ViewsRegistry } from 'vs/workbench/common/views';
import { ViewletDescriptor } from 'vs/workbench/browser/viewlet';
import { Dimension } from 'vs/base/browser/dom';

export class ActivitybarPart extends Part {

	private static readonly PINNED_VIEWLETS = 'workbench.activity.pinnedViewlets';
	private static readonly COLORS = {
		backgroundColor: ACTIVITY_BAR_FOREGROUND,
		badgeBackground: ACTIVITY_BAR_BADGE_BACKGROUND,
		badgeForeground: ACTIVITY_BAR_BADGE_FOREGROUND,
		dragAndDropBackground: ACTIVITY_BAR_DRAG_AND_DROP_BACKGROUND
	};
	private static readonly ACTION_HEIGHT = 50;

	public _serviceBrand: any;

	private dimension: Dimension;

	private globalActionBar: ActionBar;
	private globalActivityIdToActions: { [globalActivityId: string]: GlobalActivityAction; };

	private compositeBar: CompositeBar;
	private compositeActions: { [compositeId: string]: { activityAction: ViewletActivityAction, pinnedAction: ToggleCompositePinnedAction } };

	constructor(
		id: string,
		@IViewletService private viewletService: IViewletService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IPartService private partService: IPartService,
		@IThemeService themeService: IThemeService
	) {
		super(id, { hasTitle: false }, themeService);

		this.globalActivityIdToActions = Object.create(null);

		this.compositeActions = Object.create(null);
		this.compositeBar = this.instantiationService.createInstance(CompositeBar, {
			icon: true,
			storageId: ActivitybarPart.PINNED_VIEWLETS,
			orientation: ActionsOrientation.VERTICAL,
			openComposite: (compositeId: string) => this.viewletService.openViewlet(compositeId, true),
			getActivityAction: (compositeId: string) => this.getCompositeActions(compositeId).activityAction,
			getCompositePinnedAction: (compositeId: string) => this.getCompositeActions(compositeId).pinnedAction,
			getOnCompositeClickAction: (compositeId: string) => this.instantiationService.createInstance(ToggleViewletAction, this.viewletService.getViewlet(compositeId)),
			getContextMenuActions: () => [this.instantiationService.createInstance(ToggleActivityBarVisibilityAction, ToggleActivityBarVisibilityAction.ID, nls.localize('hideActivitBar', "Hide Activity Bar"))],
			getDefaultCompositeId: () => this.viewletService.getDefaultViewletId(),
			hidePart: () => this.partService.setSideBarHidden(true),
			compositeSize: 50,
			colors: ActivitybarPart.COLORS,
			overflowActionSize: ActivitybarPart.ACTION_HEIGHT
		});

		this.registerListeners();
		this.updateCompositebar();
	}

	private registerListeners(): void {

		this.toUnbind.push(this.viewletService.onDidViewletRegister(() => this.updateCompositebar()));
		this.toUnbind.push(ViewsRegistry.onViewsRegistered(() => this.updateCompositebar()));
		this.toUnbind.push(ViewsRegistry.onViewsDeregistered(() => this.updateCompositebar()));

		// Activate viewlet action on opening of a viewlet
		this.toUnbind.push(this.viewletService.onDidViewletOpen(viewlet => this.compositeBar.activateComposite(viewlet.getId())));

		// Deactivate viewlet action on close
		this.toUnbind.push(this.viewletService.onDidViewletClose(viewlet => this.compositeBar.deactivateComposite(viewlet.getId())));
		this.toUnbind.push(this.viewletService.onDidViewletEnablementChange(({ id, enabled }) => {
			if (enabled) {
				this.compositeBar.addComposite(this.viewletService.getViewlet(id), true);
			} else {
				this.removeComposite(id);
			}
		}));
	}

	public showActivity(viewletOrActionId: string, badge: IBadge, clazz?: string, priority?: number): IDisposable {
		if (this.viewletService.getViewlet(viewletOrActionId)) {
			return this.compositeBar.showActivity(viewletOrActionId, badge, clazz, priority);
		}

		return this.showGlobalActivity(viewletOrActionId, badge, clazz);
	}

	private showGlobalActivity(globalActivityId: string, badge: IBadge, clazz?: string): IDisposable {
		if (!badge) {
			throw illegalArgument('badge');
		}

		const action = this.globalActivityIdToActions[globalActivityId];
		if (!action) {
			throw illegalArgument('globalActivityId');
		}

		action.setBadge(badge, clazz);

		return toDisposable(() => action.setBadge(undefined));
	}

	public createContentArea(parent: HTMLElement): HTMLElement {
		const $el = $(parent);
		const $result = $('.content').appendTo($el);

		// Top Actionbar with action items for each viewlet action
		this.compositeBar.create($result.getHTMLElement());

		// Top Actionbar with action items for each viewlet action
		this.createGlobalActivityActionBar($('.global-activity').appendTo($result).getHTMLElement());

		return $result.getHTMLElement();
	}

	public updateStyles(): void {
		super.updateStyles();

		// Part container
		const container = $(this.getContainer());
		const background = this.getColor(ACTIVITY_BAR_BACKGROUND);
		container.style('background-color', background);

		const borderColor = this.getColor(ACTIVITY_BAR_BORDER) || this.getColor(contrastBorder);
		const isPositionLeft = this.partService.getSideBarPosition() === SideBarPosition.LEFT;
		container.style('box-sizing', borderColor && isPositionLeft ? 'border-box' : null);
		container.style('border-right-width', borderColor && isPositionLeft ? '1px' : null);
		container.style('border-right-style', borderColor && isPositionLeft ? 'solid' : null);
		container.style('border-right-color', isPositionLeft ? borderColor : null);
		container.style('border-left-width', borderColor && !isPositionLeft ? '1px' : null);
		container.style('border-left-style', borderColor && !isPositionLeft ? 'solid' : null);
		container.style('border-left-color', !isPositionLeft ? borderColor : null);
	}

	private createGlobalActivityActionBar(container: HTMLElement): void {
		const activityRegistry = Registry.as<IGlobalActivityRegistry>(GlobalActivityExtensions);
		const descriptors = activityRegistry.getActivities();
		const actions = descriptors
			.map(d => this.instantiationService.createInstance(d))
			.map(a => new GlobalActivityAction(a));

		this.globalActionBar = new ActionBar(container, {
			actionItemProvider: a => this.instantiationService.createInstance(GlobalActivityActionItem, a, ActivitybarPart.COLORS),
			orientation: ActionsOrientation.VERTICAL,
			ariaLabel: nls.localize('globalActions', "Global Actions"),
			animated: false
		});
		this.toUnbind.push(this.globalActionBar);

		actions.forEach(a => {
			this.globalActivityIdToActions[a.id] = a;
			this.globalActionBar.push(a);
		});
	}

	private getCompositeActions(compositeId: string): { activityAction: ViewletActivityAction, pinnedAction: ToggleCompositePinnedAction } {
		let compositeActions = this.compositeActions[compositeId];
		if (!compositeActions) {
			compositeActions = {
				activityAction: this.instantiationService.createInstance(ViewletActivityAction, this.viewletService.getViewlet(compositeId)),
				pinnedAction: new ToggleCompositePinnedAction(this.viewletService.getViewlet(compositeId), this.compositeBar)
			};
			this.compositeActions[compositeId] = compositeActions;
		}
		return compositeActions;
	}

	private updateCompositebar(): void {
		const viewlets = this.viewletService.getViewlets();
		for (const viewlet of viewlets) {
			const canShow = this.canShow(viewlet);
			if (canShow) {
				this.compositeBar.addComposite(viewlet, false);
				const activeViewlet = this.viewletService.getActiveViewlet();
				if (activeViewlet && activeViewlet.getId() === viewlet.id) {
					this.compositeBar.pin(viewlet.id);
					this.compositeBar.activateComposite(viewlet.id);
				}
			} else {
				this.removeComposite(viewlet.id);
			}
		}
	}

	private removeComposite(compositeId: string): void {
		this.compositeBar.removeComposite(compositeId);
		const compositeActions = this.compositeActions[compositeId];
		if (compositeActions) {
			compositeActions.activityAction.dispose();
			compositeActions.pinnedAction.dispose();
			delete this.compositeActions[compositeId];
		}
	}

	private canShow(viewlet: ViewletDescriptor): boolean {
		const viewLocation = ViewLocation.get(viewlet.id);
		if (viewLocation) {
			return ViewsRegistry.getViews(viewLocation).length > 0;
		}
		return true;
	}

	public getPinned(): string[] {
		return this.viewletService.getViewlets().map(v => v.id).filter(id => this.compositeBar.isPinned(id));
	}

	/**
	 * Layout title, content and status area in the given dimension.
	 */
	public layout(dimension: Dimension): Dimension[] {
		if (!this.partService.isVisible(Parts.ACTIVITYBAR_PART)) {
			return [dimension];
		}

		// Pass to super
		const sizes = super.layout(dimension);

		this.dimension = sizes[1];

		let availableHeight = this.dimension.height;
		if (this.globalActionBar) {
			// adjust height for global actions showing
			availableHeight -= (this.globalActionBar.items.length * ActivitybarPart.ACTION_HEIGHT);
		}
		this.compositeBar.layout(new Dimension(dimension.width, availableHeight));

		return sizes;
	}

	public shutdown(): void {
		this.compositeBar.shutdown();
		super.shutdown();
	}

	public dispose(): void {
		if (this.compositeBar) {
			this.compositeBar.dispose();
			this.compositeBar = null;
		}

		if (this.globalActionBar) {
			this.globalActionBar.dispose();
			this.globalActionBar = null;
		}

		super.dispose();
	}
}