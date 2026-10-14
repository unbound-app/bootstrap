(() => {
    const entries = new Map();
    const pending = new Map();
    const sharedByTarget = new WeakMap();
    let nextIdentifier = 1;
    let nextMutation = 1;
    let frameStart = 0;
    let frameUses = 0;
    const rendererModuleId = 116;
    const nativeWrapperKeys = [
        'View', 'Text', 'Image', 'ScrollView', 'TextInput', 'SafeAreaView',
        'Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback',
    ];
    let nativeWrapperTypes = null;

    function failure(code, message) {
        const error = new Error(message);
        error.code = code;
        return error;
    }

    function renderer() {
        if (typeof __r !== 'function') return null;
        try {
            const value = __r(rendererModuleId);
            if (!value || typeof globalThis.React?.startTransition !== 'function' ||
                typeof value.render !== 'function' ||
                value.render.length !== 5 ||
                typeof value.getNodeFromInternalInstanceHandle !== 'function' ||
                typeof value.findNodeHandle !== 'function' ||
                Object.keys(value).sort().join(',') !==
                'createPortal,dispatchCommand,findHostInstance_DEPRECATED,' +
                'findNodeHandle,getNodeFromInternalInstanceHandle,' +
                'getPublicInstanceFromInternalInstanceHandle,' +
                'getPublicInstanceFromRootTag,isChildPublicInstance,render,' +
                'sendAccessibilityEvent,stopSurface,unmountComponentAtNode') return null;
            return value;
        } catch {
            return null;
        }
    }

    function nativeWrapper(fiber) {
        if (!nativeWrapperTypes) {
            const native = globalThis.ReactNative;
            if (!native) return false;
            nativeWrapperTypes = new Set();
            for (const key of nativeWrapperKeys) {
                const component = native[key];
                const animated = native.Animated?.[key];
                if (component) nativeWrapperTypes.add(component);
                if (animated) nativeWrapperTypes.add(animated);
            }
        }
        return nativeWrapperTypes.has(fiber.elementType);
    }

    function resolve(tag, x, y) {
        const manager = globalThis.nativeFabricUIManager;
        if (!manager || typeof manager.findShadowNodeByTag_DEPRECATED !== 'function' ||
            typeof manager.findNodeAtPoint !== 'function') return null;
        const shadow = manager.findShadowNodeByTag_DEPRECATED(tag);
        if (!shadow) return null;
        let hit = null;
        manager.findNodeAtPoint(shadow, x, y, fiber => { hit = fiber; });
        let host = hit;
        for (let depth = 0; host && depth < 512; depth++, host = host.return) {
            if (host.stateNode?.canonical?.nativeTag === tag) break;
        }
        if (!host || host.stateNode?.canonical?.nativeTag !== tag) return null;
        let mountedRoot = host;
        for (let depth = 0; mountedRoot && depth < 512;
            depth++, mountedRoot = mountedRoot.return) {
            if (mountedRoot.tag === 3) break;
        }
        if (!mountedRoot || mountedRoot.tag !== 3) return null;
        if (mountedRoot.stateNode?.current !== mountedRoot) {
            host = host.alternate;
            if (!host || host.stateNode?.canonical?.nativeTag !== tag) return null;
        }
        let target = host.return;
        for (let depth = 0; target && depth < 512; depth++, target = target.return) {
            if ((target.tag === 0 || target.tag === 1 ||
                 target.tag === 11 || target.tag === 14 || target.tag === 15) &&
                !nativeWrapper(target)) break;
            if (target.tag === 3) return null;
        }
        if (!target || !target.return) return null;
        let rootFiber = target;
        for (let depth = 0; rootFiber && depth < 512; depth++, rootFiber = rootFiber.return) {
            if (rootFiber.tag === 19 ||
                ((rootFiber.tag === 13 || rootFiber.tag === 22) &&
                 rootFiber.memoizedState !== null)) return null;
            if (rootFiber.tag === 3) break;
        }
        if (!rootFiber || rootFiber.tag !== 3) return null;
        const root = rootFiber.stateNode;
        const rootTag = root?.containerInfo?.containerTag;
        if (!root || root.current !== rootFiber ||
            !Number.isSafeInteger(rootTag) || rootTag <= 0 ||
            !root.current.memoizedState?.element) return null;
        return { host, target, root, rootTag, props: target.memoizedProps, tag };
    }

    function current(entry, tag, x, y) {
        if (entry.tag !== tag) return null;
        const found = resolve(tag, x, y);
        if (!found || found.root !== entry.root ||
            (found.host !== entry.host && found.host !== entry.host.alternate) ||
            (found.target !== entry.target && found.target !== entry.target.alternate) ||
            found.props !== entry.props) return null;
        return found;
    }

    function mark(mutations, node, field, value) {
        if (!node) return;
        const before = node[field];
        const after = before | value;
        if (before === after) return;
        node[field] = after;
        mutations.push({ node, field, before, after });
    }

    function markKey(mutations, node, marker, entry, tag, x, y) {
        if (!node) return;
        const descriptor = Object.getOwnPropertyDescriptor(node, 'key');
        if (!descriptor || !descriptor.configurable || !('value' in descriptor)) {
            throw failure('NATIVE_REACT_UNSUPPORTED_RENDERER', 'Fiber key cannot be guarded');
        }
        const active = { value: true, read: false };
        const guard = () => {
            if (!active.value) return descriptor.value;
            const found = current(entry, tag, x, y);
            if (!found || node.pendingProps !== entry.props ||
                node.return?.pendingProps !== node.return?.memoizedProps ||
                found.target.pendingProps !== entry.props ||
                found.target.return?.pendingProps !== found.target.return?.memoizedProps) {
                return descriptor.value;
            }
            active.read = true;
            return marker;
        };
        Object.defineProperty(node, 'key', {
            configurable: true,
            enumerable: descriptor.enumerable,
            get: guard,
        });
        mutations.push({ node, field: 'key', descriptor, guard, active });
    }

    function restore(mutations, keysOnly = false) {
        for (let index = mutations.length - 1; index >= 0; index--) {
            const mutation = mutations[index];
            if (mutation.field === 'key') {
                mutation.active.value = false;
                if (Object.getOwnPropertyDescriptor(mutation.node, 'key')?.get === mutation.guard) {
                    Object.defineProperty(mutation.node, 'key', mutation.descriptor);
                }
                continue;
            }
            if (keysOnly) continue;
            if (mutation.node[mutation.field] === mutation.after) {
                mutation.node[mutation.field] = mutation.before;
            }
        }
    }

    function mounted(node, root) {
        for (let depth = 0; node && depth < 512; depth++, node = node.return) {
            if (node === root.current) return true;
        }
        return false;
    }

    function remounted(entry, target, parent, tag, x, y, keyRead) {
        if (target.pendingProps !== entry.props) return 'target-stale';
        const currentParent = mounted(parent, entry.root) ? parent : parent.alternate;
        if (!currentParent || !mounted(currentParent, entry.root) ||
            currentParent.memoizedProps !== parent.memoizedProps) return 'parent-stale';
        let child = currentParent.child;
        for (let count = 0; child && count < 256; count++, child = child.sibling) {
            if (child.index !== target.index) continue;
            if (!keyRead || child === target || child === target.alternate ||
                child.elementType !== target.elementType)
                return 'target-unchanged';
            const currentHost = resolve(tag, x, y);
            if (currentHost &&
                (currentHost.root !== entry.root || currentHost.target !== child ||
                 currentHost.props !== entry.props ||
                 currentHost.host === entry.host ||
                 currentHost.host === entry.host.alternate)) return 'view-reused';
            return 'ok';
        }
        return 'target-missing';
    }

    return {
        supported() {
            return renderer() !== null;
        },
        lookup(tag, x, y) {
            if (!renderer() || !Number.isSafeInteger(tag) || tag <= 0 ||
                !Number.isFinite(x) || !Number.isFinite(y)) return null;
            const entry = resolve(tag, x, y);
            if (!entry) return null;
            if (entries.size >= 256) {
                const oldest = entries.keys().next().value;
                if (!pending.has(oldest)) entries.delete(oldest);
                else return null;
            }
            const identifier = nextIdentifier++;
            entries.set(identifier, entry);
            return identifier;
        },
        release(identifier) {
            const operation = pending.get(identifier);
            operation?.cancel();
            entries.delete(identifier);
        },
        cancel(identifier) {
            pending.get(identifier)?.cancel();
        },
        shared(identifier) {
            const entry = entries.get(identifier);
            const operation = entry ? sharedByTarget.get(entry.target) : null;
            return operation?.identifier === identifier ? operation.promise : null;
        },
        remount(identifier, tag, x, y) {
            const existing = pending.get(identifier);
            if (existing) return existing.promise;
            const entry = entries.get(identifier);
            if (!entry) throw failure('NATIVE_REACT_STALE_FIBER', 'Fiber handle is no longer active');
            const shared = sharedByTarget.get(entry.target);
            if (shared) throw failure('NATIVE_REACT_BUSY', 'Another Fiber handle is remounting this component');
            const found = current(entry, tag, x, y);
            if (!found) throw failure('NATIVE_REACT_STALE_FIBER', 'Native view or Fiber changed');
            const reconciler = renderer();
            if (!reconciler) {
                throw failure('NATIVE_REACT_UNSUPPORTED_RENDERER', 'React renderer is unavailable');
            }
            const { root, rootTag, target } = found;
            if (root.pendingLanes !== 0) {
                throw failure('NATIVE_REACT_BUSY', 'React root already has pending work');
            }
            if (root.tag !== 1 || root.current.mode !== 1 ||
                (root.current.alternate && root.current.alternate.mode !== 1)) {
                throw failure('NATIVE_REACT_UNSUPPORTED_RENDERER',
                    'React root cannot perform an isolated remount');
            }
            const now = Date.now();
            if (now - frameStart >= 16) {
                frameStart = now;
                frameUses = 0;
            }
            if (frameUses >= 4) {
                throw failure('NATIVE_REACT_BUSY', 'Remount frame budget is exhausted');
            }
            frameUses++;
            const parent = target.return;
            const mutations = [];
            let settled = false;
            let cancelled = null;
            let timeout = null;
            let cancellationTimeout = null;
            let resolvePromise;
            let rejectPromise;
            const promise = new Promise((resolve, reject) => {
                resolvePromise = resolve;
                rejectPromise = reject;
            });
            const finish = (error, committed = false) => {
                if (settled) return;
                settled = true;
                if (timeout !== null) clearTimeout(timeout);
                if (cancellationTimeout !== null) clearTimeout(cancellationTimeout);
                if (error) {
                    pending.delete(identifier);
                    if (sharedByTarget.get(entry.target) === operation) {
                        sharedByTarget.delete(entry.target);
                    }
                    if (committed) entries.delete(identifier);
                    restore(mutations);
                    rejectPromise(error);
                    return;
                }
                restore(mutations);
                resolvePromise();
                Promise.resolve().then(() => {
                    pending.delete(identifier);
                    entries.delete(identifier);
                    if (sharedByTarget.get(entry.target) === operation) {
                        sharedByTarget.delete(entry.target);
                    }
                });
            };
            const abort = error => {
                if (settled || cancelled) return;
                cancelled = error;
                const keyRead = mutations.some(mutation =>
                    mutation.field === 'key' && mutation.active.read);
                restore(mutations, true);
                if (!keyRead) {
                    finish(error);
                    return;
                }
                cancellationTimeout = setTimeout(() => finish(error), 3000);
                try {
                    globalThis.React.startTransition(() => {
                        reconciler.render(root.current.memoizedState.element, rootTag, () => {
                            finish(error);
                        });
                    });
                } catch (overrideError) {
                    finish(overrideError);
                }
            };
            const operation = {
                identifier,
                promise,
                cancel() {
                    abort(failure('NATIVE_PLUGIN_SCOPE_DISPOSED', 'Remount was cancelled'));
                },
            };
            pending.set(identifier, operation);
            sharedByTarget.set(entry.target, operation);
            promise.cancel = operation.cancel;
            try {
                const element = root.current.memoizedState.element;
                globalThis.React.startTransition(() => {
                    reconciler.render(element, rootTag, () => {
                        if (settled) return;
                        if (cancelled) {
                            finish(cancelled);
                            return;
                        }
                        const keyRead = mutations.some(mutation =>
                            mutation.field === 'key' && mutation.active.read);
                        const outcome = remounted(entry, target, parent, tag, x, y, keyRead);
                        if (outcome !== 'ok') {
                            const code = outcome === 'target-unchanged'
                                ? 'NATIVE_REACT_UNSUPPORTED_RENDERER' : 'NATIVE_REACT_STALE_FIBER';
                            finish(failure(code,
                                'React did not remount the requested component: ' + outcome), true);
                            return;
                        }
                        finish(null, true);
                    });
                });
                if (settled) return promise;
                const lane = root.pendingLanes;
                if (lane <= 0 || (lane & (lane - 1)) !== 0) {
                    finish(failure('NATIVE_REACT_UNSUPPORTED_RENDERER',
                        'React did not schedule an isolated transition'));
                    return promise;
                }
                const marker = '__native_remount_' + identifier + '_' + nextMutation++;
                markKey(mutations, target, marker, entry, tag, x, y);
                markKey(mutations, target.alternate, marker, entry, tag, x, y);
                mark(mutations, parent, 'lanes', lane);
                mark(mutations, parent.alternate, 'lanes', lane);
                for (let node = parent.return, depth = 0; node && depth < 512;
                    node = node.return, depth++) {
                    mark(mutations, node, 'childLanes', lane);
                    mark(mutations, node.alternate, 'childLanes', lane);
                }
                timeout = setTimeout(() => {
                    abort(failure('NATIVE_REACT_TIMEOUT', 'React remount timed out'));
                }, 3000);
            } catch (error) {
                abort(error);
            }
            return promise;
        },
    };
})()
