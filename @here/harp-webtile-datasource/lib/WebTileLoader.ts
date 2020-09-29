/*
 * Copyright (C) 2017-2020 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

import { ITileLoader, Tile, TileLoaderState } from "@here/harp-mapview";
import { TileGeometryCreator } from "@here/harp-mapview/lib/geometry/TileGeometryCreator";
import { enableBlending } from "@here/harp-materials";
import { LoggerManager } from "@here/harp-utils";
import * as THREE from "three";

import { WebTileDataProvider, WebTileDataSource } from "./WebTileDataSource";

const logger = LoggerManager.instance.create("WebTileLoader");

/**
 * TileLoader used by `WebTileDataSource`.
 */
export class WebTileLoader implements ITileLoader {
    state: TileLoaderState = TileLoaderState.Initialized;

    /**
     * The abort controller notifying the [[DataProvider]] to cancel loading.
     */
    private loadAbortController = new AbortController();

    /**
     * The promise which is resolved when loading and decoding have finished.
     */
    private donePromise?: Promise<TileLoaderState>;

    /**
     * The internal function that is called when loading and decoding have finished successfully.
     */
    private resolveDonePromise?: (state: TileLoaderState) => void;

    /**
     * The internal function that is called when loading and decoding failed.
     */
    private rejectedDonePromise?: (state: TileLoaderState) => void;

    /**
     * Set up loading of a single [[Tile]].
     *
     * @param dataSource - The [[DataSource]] the tile belongs to.
     * @param tileKey - The quadtree address of a [[Tile]].
     * @param dataProvider - The [[DataProvider]] that retrieves the binary tile data.
     * @param tileDecoder - The [[ITileDecoder]] that decodes the binary tile to a [[DecodeTile]].
     * @param priority - The priority given to the loading job. Highest number will be served first.
     */
    constructor(
        protected dataSource: WebTileDataSource,
        private readonly tile: Tile,
        private readonly dataProvider: WebTileDataProvider,
        public priority: number = 0
    ) {}

    /**
     * Return `true` if [[Tile]] is still loading, `false` otherwise.
     */
    get isFinished(): boolean {
        return (
            this.state === TileLoaderState.Ready ||
            this.state === TileLoaderState.Canceled ||
            this.state === TileLoaderState.Failed
        );
    }

    loadAndDecode(): Promise<TileLoaderState> {
        switch (this.state) {
            case TileLoaderState.Loading:
            case TileLoaderState.Loaded:
            case TileLoaderState.Decoding:
                // tile is already loading
                return this.donePromise!;

            case TileLoaderState.Ready:
            case TileLoaderState.Failed:
            case TileLoaderState.Initialized:
            case TileLoaderState.Canceled:
                // restart loading
                this.startLoading();
                return this.donePromise!;
        }
    }

    waitSettled(): Promise<TileLoaderState> {
        if (!this.donePromise) {
            return Promise.resolve(this.state);
        }
        return this.donePromise;
    }

    updatePriority(area: number): void {}

    cancel(): void {
        switch (this.state) {
            case TileLoaderState.Loading:
                this.loadAbortController.abort();
                this.loadAbortController = new AbortController();
                break;
        }

        this.onDone(TileLoaderState.Canceled);
    }

    private startLoading() {
        const myLoadCancellationToken = this.loadAbortController.signal;

        this.dataProvider
            .getTexture(this.tile, myLoadCancellationToken)
            .then(
                value => {
                    if (value === undefined || value[0] === undefined) {
                        this.tile.forceHasGeometry(true);
                        return;
                    }

                    const [texture, copyrightInfo] = value;
                    if (copyrightInfo !== undefined) {
                        this.tile.copyrightInfo = copyrightInfo;
                    }

                    texture.minFilter = THREE.LinearFilter;
                    texture.magFilter = THREE.LinearFilter;
                    texture.generateMipmaps = false;
                    this.tile.addOwnedTexture(texture);

                    const material = new THREE.MeshBasicMaterial({
                        map: texture,
                        opacity: this.dataSource.opacity,
                        depthTest: false,
                        depthWrite: false
                    });
                    if (this.dataSource.transparent) {
                        enableBlending(material);
                    }
                    const mesh = TileGeometryCreator.instance.createGroundPlane(
                        this.tile,
                        material,
                        true
                    );
                    this.tile.objects.push(mesh);
                    mesh.renderOrder = this.dataSource.renderOrder;
                    this.tile.invalidateResourceInfo();
                    this.dataSource.requestUpdate();
                },
                error => {
                    this.onError(error);
                }
            )
            .catch(error => {
                this.onError(error);
            });

        if (this.donePromise === undefined) {
            this.donePromise = new Promise<TileLoaderState>((resolve, reject) => {
                this.resolveDonePromise = resolve;
                this.rejectedDonePromise = reject;
            });
        }
        this.state = TileLoaderState.Loading;
    }

    private onDone(doneState: TileLoaderState) {
        if (this.resolveDonePromise && doneState === TileLoaderState.Ready) {
            this.resolveDonePromise(doneState);
        } else if (this.rejectedDonePromise) {
            this.rejectedDonePromise(doneState);
        }
        this.resolveDonePromise = undefined;
        this.rejectedDonePromise = undefined;
        this.donePromise = undefined;
        this.state = doneState;
    }

    private onError(error: Error) {
        if (this.state === TileLoaderState.Canceled) {
            // If we're canceled, we should simply ignore any state transitions and errors from
            // underlying load/decode ops.
            return;
        }
        const dataSource = this.dataSource;
        logger.error(
            `[${dataSource.name}]: failed to load webtile ${this.tile.tileKey.mortonCode()}`,
            error
        );

        this.onDone(TileLoaderState.Failed);
    }
}
