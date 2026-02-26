import { mount } from "svelte";
import LiveDataApp from "./LiveDataApp.svelte";

const target = document.getElementById("app");
if (!target) {
	throw new Error(
		"Failed to mount LiveDataApp: root element #app not found in DOM",
	);
}

const app = mount(LiveDataApp, {
	target,
});

export default app;
